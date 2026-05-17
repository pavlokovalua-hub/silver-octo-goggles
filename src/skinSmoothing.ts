/**
 * Optimised Skin Smoothing Module
 *
 * GPU-accelerated: blurs at half resolution (4× fewer pixels),
 * reuses canvases across frames (zero GC), and composites via
 * alpha-channel masking and globalAlpha — no per-pixel JS blend loop.
 *
 * Pipeline:
 *   1. Build feathered skin mask (reusable mask canvas)
 *   2. Downscale frame to ½ resolution, blur it
 *   3. Copy mask alpha → blurred frame's alpha channel
 *   4. Composite blurred frame over original via globalAlpha
 *   5. Upscale back to full resolution (free bilinear from canvas)
 */

// ---------------------------------------------------------------------------
// MediaPipe Face Mesh landmark sets
// ---------------------------------------------------------------------------

const FACE_OVAL_INDICES: number[] = [
  10, 338, 297, 332, 284, 251, 389, 356, 454, 323, 361, 288,
  397, 365, 379, 378, 400, 377, 152, 148, 176, 149, 150, 136,
  172, 58, 132, 93, 234, 127, 162, 21, 54, 103, 67, 109,
];

const LEFT_EYE_INDICES: number[] = [
  33, 7, 163, 144, 145, 153, 154, 155, 133, 173, 157, 158, 159, 160, 161, 246,
];

const RIGHT_EYE_INDICES: number[] = [
  263, 249, 390, 373, 374, 380, 381, 382, 362, 398, 384, 385, 386, 387, 388, 466,
];

const LIPS_OUTER_INDICES: number[] = [
  61, 146, 91, 181, 84, 17, 314, 405, 321, 375, 291, 308,
  324, 318, 402, 317, 14, 87, 178, 88, 95, 185, 40, 39, 37,
  0, 267, 269, 270, 409, 287, 273, 335, 406, 313, 18, 83, 182, 106, 43,
];

const LEFT_EYEBROW_INDICES: number[] = [70, 63, 105, 66, 107, 55, 65, 52, 53, 46];
const RIGHT_EYEBROW_INDICES: number[] = [336, 296, 334, 293, 300, 285, 295, 282, 283, 276];

const FEATURE_SETS: number[][] = [
  LEFT_EYE_INDICES, RIGHT_EYE_INDICES, LIPS_OUTER_INDICES,
  LEFT_EYEBROW_INDICES, RIGHT_EYEBROW_INDICES,
];

const CRITICAL_FEATURES: number[][] = [
  LEFT_EYE_INDICES, RIGHT_EYE_INDICES,
  LEFT_EYEBROW_INDICES, RIGHT_EYEBROW_INDICES,
];

// ---------------------------------------------------------------------------
// Reusable offscreen canvases (allocated once, reused every frame)
// ---------------------------------------------------------------------------

let _maskCanvas: HTMLCanvasElement | null = null;
let _maskCtx: CanvasRenderingContext2D | null = null;
let _blurCanvas: HTMLCanvasElement | null = null;
let _blurCtx: CanvasRenderingContext2D | null = null;

function ensureCanvases(w: number, h: number) {
  if (!_maskCanvas || _maskCanvas.width !== w || _maskCanvas.height !== h) {
    _maskCanvas = document.createElement('canvas');
    _maskCanvas.width = w;
    _maskCanvas.height = h;
    _maskCtx = _maskCanvas.getContext('2d')!;
  }
  if (!_blurCanvas || _blurCanvas.width !== w || _blurCanvas.height !== h) {
    _blurCanvas = document.createElement('canvas');
    _blurCanvas.width = w;
    _blurCanvas.height = h;
    _blurCtx = _blurCanvas.getContext('2d')!;
  }
}

// ---------------------------------------------------------------------------
// Polygon helper
// ---------------------------------------------------------------------------

function fillPolygon(
  ctx: CanvasRenderingContext2D,
  landmarks: Array<{ x: number; y: number }>,
  indices: number[],
  scaleX: number,
  scaleY: number,
): void {
  ctx.beginPath();
  ctx.moveTo(landmarks[indices[0]].x * scaleX, landmarks[indices[0]].y * scaleY);
  for (let i = 1; i < indices.length; i++) {
    ctx.lineTo(landmarks[indices[i]].x * scaleX, landmarks[indices[i]].y * scaleY);
  }
  ctx.closePath();
  ctx.fill();
}

// ---------------------------------------------------------------------------
// applySkinSmoothing  (main export)
// ---------------------------------------------------------------------------

export function applySkinSmoothing(
  ctx: CanvasRenderingContext2D,
  landmarks: Array<{ x: number; y: number }>,
  width: number,
  height: number,
  strength: number = 0.5,
): void {
  if (strength <= 0) return;

  // Half-resolution working size (4× fewer pixels)
  const sw = Math.max(1, Math.round(width / 2));
  const sh = Math.max(1, Math.round(height / 2));

  ensureCanvases(sw, sh);

  // ── 1. Build feathered skin mask (grayscale: 0=features, 255=skin) ──
  const mCtx = _maskCtx!;
  mCtx.fillStyle = '#000000';
  mCtx.fillRect(0, 0, sw, sh);

  mCtx.fillStyle = '#ffffff';
  fillPolygon(mCtx, landmarks, FACE_OVAL_INDICES, sw, sh);

  mCtx.fillStyle = '#000000';
  for (const indices of FEATURE_SETS) {
    fillPolygon(mCtx, landmarks, indices, sw, sh);
  }

  // Feather all edges
  mCtx.filter = 'blur(8px)';
  mCtx.fillStyle = '#ffffff';
  fillPolygon(mCtx, landmarks, FACE_OVAL_INDICES, sw, sh);
  mCtx.filter = 'none';

  // Sharply re-cut eyes & brows (zero smoothing)
  mCtx.fillStyle = '#000000';
  for (const indices of CRITICAL_FEATURES) {
    fillPolygon(mCtx, landmarks, indices, sw, sh);
  }

  // ── 2. Downscale & blur the frame ──
  const bCtx = _blurCtx!;
  bCtx.drawImage(ctx.canvas, 0, 0, sw, sh);

  const blurRadius = Math.max(2, Math.round(strength * 20));
  bCtx.filter = `blur(${blurRadius}px)`;
  bCtx.drawImage(_blurCanvas!, 0, 0);
  bCtx.filter = 'none';

  // ── 3. Apply skin mask to the blurred frame's alpha channel ──
  //    Where mask = 0 (eyes/brows) → alpha = 0 → invisible when composited
  //    Where mask > 0 (skin) → alpha = mask → visible with soft feather edges
  const blurredData = bCtx.getImageData(0, 0, sw, sh);
  const maskData = mCtx.getImageData(0, 0, sw, sh);
  const n = sw * sh;

  for (let i = 0; i < n; i++) {
    const idx = i * 4;
    // Set alpha to mask luminance (R, G, B are identical in grayscale mask)
    blurredData.data[idx + 3] = maskData.data[idx];
  }
  bCtx.putImageData(blurredData, 0, 0);

  // ── 4. Composite over the original canvas ──
  //    globalAlpha applies uniformly to all blurred pixels.
  //    Per-pixel variation comes from the alpha channel we just set.
  //    Canvas compositing: result = src * srcAlpha + dst * (1 - srcAlpha)
  //    So: skin pixels (alpha=255) get full blend at globalAlpha
  //        eyes (alpha=0) are invisible → original shows through
  //        edges (alpha=128) get 50% of the blur effect
  ctx.save();
  ctx.globalAlpha = strength;
  ctx.drawImage(_blurCanvas!, 0, 0, width, height);
  ctx.restore();
}
