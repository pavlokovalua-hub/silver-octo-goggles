/**
 * Optimised Skin Smoothing Module — v2 (GPU-only, no getImageData/putImageData)
 *
 * Позбуваємося дорогого CPU↔GPU roundtrip через getImageData/putImageData.
 *
 * Новий pipeline (чисто GPU через canvas compositing):
 *   1. Будуємо маску шкіри з прозорим фоном (альфа-канал = ступінь накладання)
 *   2. Зменшуємо кадр до ½ розміру, розмиваємо (4× менше пікселів)
 *   3. destination-in: накладаємо маску на розмитий кадр (альфа маски = α розмиття)
 *   4. Композитимо через globalAlpha + drawImage (upscale — безкоштовний білінійний)
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

const EYE_BROW_SETS: number[][] = [
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
// applySkinSmoothing  (main export) — v2: GPU-only compositing
// ---------------------------------------------------------------------------

export function applySkinSmoothing(
  ctx: CanvasRenderingContext2D,
  landmarks: Array<{ x: number; y: number }>,
  width: number,
  height: number,
  strength: number = 0.5,
): void {
  if (strength <= 0) return;

  // Half-resolution (4× fewer pixels = ~4× faster blur)
  const sw = Math.max(1, Math.round(width / 2));
  const sh = Math.max(1, Math.round(height / 2));

  ensureCanvases(sw, sh);

  // ── 1. Build skin mask with alpha feathering (GPU-only) ──
  const mCtx = _maskCtx!;

  // Start with fully transparent canvas
  mCtx.clearRect(0, 0, sw, sh);

  // Fill face oval with white (fully opaque — A=255)
  mCtx.fillStyle = '#ffffff';
  fillPolygon(mCtx, landmarks, FACE_OVAL_INDICES, sw, sh);

  // First feather pass: blur the white fill
  // This creates semitransparent pixels at the oval edges
  mCtx.filter = 'blur(8px)';
  fillPolygon(mCtx, landmarks, FACE_OVAL_INDICES, sw, sh);
  mCtx.filter = 'none';

  // Cut out features (eyes, brows, lips) using destination-out
  // This sets their alpha to 0 (fully transparent)
  mCtx.globalCompositeOperation = 'destination-out';
  mCtx.fillStyle = '#ffffff';
  for (const indices of FEATURE_SETS) {
    fillPolygon(mCtx, landmarks, indices, sw, sh);
  }
  mCtx.globalCompositeOperation = 'source-over';

  // ── 2. Downscale & blur the frame ──
  const bCtx = _blurCtx!;
  bCtx.clearRect(0, 0, sw, sh);
  bCtx.drawImage(ctx.canvas, 0, 0, sw, sh);

  const blurRadius = Math.max(2, Math.round(strength * 20));
  bCtx.filter = `blur(${blurRadius}px)`;
  bCtx.drawImage(_blurCanvas!, 0, 0);
  bCtx.filter = 'none';

  // ── 3. Apply mask alpha to blurred frame via destination-in ──
  //    Where mask has alpha=0 → blurred is removed
  //    Where mask has alpha=255 → blurred is fully kept
  //    Where mask has alpha=128 → blurred is 50% kept (feathering)
  bCtx.globalCompositeOperation = 'destination-in';
  bCtx.drawImage(_maskCanvas!, 0, 0);
  bCtx.globalCompositeOperation = 'source-over';

  // ── 4. Composite over the original canvas ──
  //    globalAlpha controls overall effect strength
  ctx.save();
  ctx.globalAlpha = strength;
  ctx.drawImage(_blurCanvas!, 0, 0, width, height);
  ctx.restore();
}
