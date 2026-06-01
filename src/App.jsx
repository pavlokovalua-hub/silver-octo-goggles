import React, { useEffect, useRef, useState } from 'react';
import { FaceMesh } from '@mediapipe/face_mesh';
import * as cam from '@mediapipe/camera_utils';
import { applySkinSmoothing } from './skinSmoothing';
import foundationsData from './datasets/foundations.json';

const FOREHEAD_EXTEND_EYEBROW_OFFSET = 0.01;

// ─────── Модульні константи (лендмарки) ───────
const FACE_OVAL = [
  10, 338, 297, 332, 284, 251, 389, 356, 454, 323, 361, 288,
  397, 365, 379, 378, 400, 377, 152, 148, 176, 149, 150, 136,
  172, 58, 132, 93, 234, 127, 162, 21, 54, 103, 67, 109,
];
const LIPS_UPPER_OUTER = [61, 185, 40, 39, 37, 0, 267, 269, 270, 409, 291, 308, 415, 310, 311, 312, 13, 82, 81, 80, 191, 78];
const LIPS_LOWER_OUTER = [61, 146, 91, 181, 84, 17, 314, 405, 321, 375, 291, 308, 324, 318, 402, 317, 14, 87, 178, 88, 95, 78];
const LIPS_UPPER_BORDER_OUTER = [61, 185, 40, 39, 37, 0, 267, 269, 270, 409, 291, 409, 270, 269, 267, 0, 37, 39, 40, 185, 61];
const LIPS_LOWER_BORDER_OUTER = [61, 146, 91, 181, 84, 17, 314, 405, 321, 375, 291, 375, 321, 405, 314, 17, 84, 181, 91, 146, 61];
const LEFT_EYE = [33, 7, 163, 144, 145, 153, 154, 155, 133, 173, 157, 158, 159, 160, 161, 246];
const RIGHT_EYE = [263, 249, 390, 373, 374, 380, 381, 382, 362, 398, 384, 385, 386, 387, 388, 466];
const LEFT_EYEBROW = [70, 63, 105, 66, 107, 55, 65, 52, 53, 46];
const RIGHT_EYEBROW = [336, 296, 334, 293, 300, 285, 295, 282, 283, 276];
const BLUSH_LEFT = [116, 117, 118, 119, 120, 121, 128, 50, 205, 49, 110, 203, 204];
const BLUSH_RIGHT = [345, 346, 347, 348, 349, 350, 357, 280, 425, 279, 339, 423, 424];
const LEFT_IRIS = [468, 469, 470, 471, 472];
const RIGHT_IRIS = [473, 474, 475, 476, 477];
// Внутрішній контур рота (простір між губами — зуби, порожнина рота)
const MOUTH_INTERIOR = [78, 191, 80, 81, 82, 13, 312, 311, 310, 415, 308, 324, 318, 402, 317, 14, 87, 178, 88, 95, 78];
const ALL_BROWS = [...LEFT_EYEBROW, ...RIGHT_EYEBROW];
// Вирізається ТІЛЬКИ: очі (щоб не фарбувались) і внутрішня частина рота (зуби/порожнина).
// Брови та губи мають бути в тоні шкіри.
const CUTOUT_GROUPS = [
  LEFT_EYE, RIGHT_EYE,
  LEFT_IRIS, RIGHT_IRIS,
  MOUTH_INTERIOR,
];

// ─────── RGB-парсинг ───────
function rgbStrToHex(rgbStr) {
  const match = rgbStr.match(/rgb\s*\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)/);
  if (!match) return '#000000';
  const r = parseInt(match[1]);
  const g = parseInt(match[2]);
  const b = parseInt(match[3]);
  return '#' + [r, g, b].map(v => v.toString(16).padStart(2, '0')).join('');
}

function getLastDigits(sku) {
  return sku.slice(-3);
}

// Підготовлені дані тонів
const foundationTones = foundationsData.map(item => {
  const hex = rgbStrToHex(item.background);
  const number = getLastDigits(item.sku);
  return { sku: item.sku, hex, number };
});

// ─────── hex → RGB з кешем ───────
const _hexRgbCache = new Map();
function hexToRgb(hex) {
  const cached = _hexRgbCache.get(hex);
  if (cached) return cached;
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  if (!result) return null;
  const rgb = {
    r: parseInt(result[1], 16),
    g: parseInt(result[2], 16),
    b: parseInt(result[3], 16),
  };
  if (_hexRgbCache.size > 100) _hexRgbCache.clear();
  _hexRgbCache.set(hex, rgb);
  return rgb;
}

// ─────── Canvas-допоміжні функції ───────
function fillPath(ctx, landmarks, indices, fw, fh) {
  if (indices.length === 0) return;
  ctx.beginPath();
  ctx.moveTo(landmarks[indices[0]].x * fw, landmarks[indices[0]].y * fh);
  for (let i = 1; i < indices.length; i++) {
    const pt = landmarks[indices[i]];
    if (pt) ctx.lineTo(pt.x * fw, pt.y * fh);
  }
  ctx.closePath();
}

function fillPathDirect(ctx, landmarks, indices, sw, sh) {
  ctx.beginPath();
  ctx.moveTo(landmarks[indices[0]].x * sw, landmarks[indices[0]].y * sh);
  for (let i = 1; i < indices.length; i++) {
    ctx.lineTo(landmarks[indices[i]].x * sw, landmarks[indices[i]].y * sh);
  }
  ctx.closePath();
  ctx.fill();
}

function strokePath(ctx, landmarks, indices, fw, fh) {
  if (indices.length < 2) return;
  ctx.beginPath();
  ctx.moveTo(landmarks[indices[0]].x * fw, landmarks[indices[0]].y * fh);
  for (let i = 1; i < indices.length; i++) {
    const pt = landmarks[indices[i]];
    if (pt) ctx.lineTo(pt.x * fw, pt.y * fh);
  }
  const first = landmarks[indices[0]];
  if (first) ctx.lineTo(first.x * fw, first.y * fh);
}

function computeFaceBounds(landmarks) {
  let minX = 1, maxX = 0;
  let ovalMinY = 1, ovalMaxY = 0;
  let eyebrowTopY = 1;
  for (const idx of FACE_OVAL) {
    const pt = landmarks[idx];
    if (pt) {
      if (pt.x < minX) minX = pt.x;
      if (pt.x > maxX) maxX = pt.x;
      if (pt.y < ovalMinY) ovalMinY = pt.y;
      if (pt.y > ovalMaxY) ovalMaxY = pt.y;
    }
  }
  for (const idx of ALL_BROWS) {
    const pt = landmarks[idx];
    if (pt && pt.y < eyebrowTopY) eyebrowTopY = pt.y;
  }
  return { minX, maxX, ovalMinY, ovalMaxY, eyebrowTopY };
}

function ensureLayerCanvas(ref, w, h) {
  if (!ref.current || ref.current.width !== w || ref.current.height !== h) {
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    ref.current = c;
  }
  return ref.current.getContext('2d');
}

// Вирізає очі та внутрішню частину рота (зуби/порожнину) з шару тональника.
// Брови та губи НЕ вирізаються — вони мають бути в тоні шкіри.
function punchOutEyesMouth(ctx, landmarks, fw, fh) {
  ctx.save();
  ctx.globalCompositeOperation = 'destination-out';
  ctx.fillStyle = 'rgba(0,0,0,1)';
  ctx.strokeStyle = 'rgba(0,0,0,1)';
  ctx.lineWidth = 6;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';

  for (const group of CUTOUT_GROUPS) {
    if (group.length < 2) continue;
    ctx.beginPath();
    ctx.moveTo(landmarks[group[0]].x * fw, landmarks[group[0]].y * fh);
    for (let i = 1; i < group.length; i++) {
      const pt = landmarks[group[i]];
      if (pt) ctx.lineTo(pt.x * fw, pt.y * fh);
    }
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  }
  ctx.restore();
}

// ────────── Основний компонент ──────────
function App() {
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const latestMakeupState = useRef({
    foundationColor: '#f3cfb3',
    opacity: 0.48,
    matte: 0.09,
    lipColor: '#BD2846',
    blushColor: '#f3bebe',
    lipGlossColor: '#310606',
    lipGlossOpacity: 0.19,
    lipLinerColor: '#390404',
    showFoundation: true,
    showBlush: true,
    showLip: true,
    showGloss: true,
    showLipLiner: true,
    skinSmooth: true,
    skinSmoothStrength: 0.35,
    eyeBrightness: 0.05,
  });

  const [foundationColor, setFoundationColor] = useState(latestMakeupState.current.foundationColor);
  const [opacity, setOpacity] = useState(latestMakeupState.current.opacity);
  const [matte, setMatte] = useState(latestMakeupState.current.matte);
  const [lipColor, setLipColor] = useState(latestMakeupState.current.lipColor);
  const [blushColor, setBlushColor] = useState(latestMakeupState.current.blushColor);
  const [lipGlossColor, setLipGlossColor] = useState(latestMakeupState.current.lipGlossColor);
  const [lipGlossOpacity, setLipGlossOpacity] = useState(latestMakeupState.current.lipGlossOpacity);
  const [lipLinerColor, setLipLinerColor] = useState(latestMakeupState.current.lipLinerColor);
  const [showFoundation, setShowFoundation] = useState(latestMakeupState.current.showFoundation);
  const [showBlush, setShowBlush] = useState(latestMakeupState.current.showBlush);
  const [showLip, setShowLip] = useState(latestMakeupState.current.showLip);
  const [showGloss, setShowGloss] = useState(latestMakeupState.current.showGloss);
  const [showLipLiner, setShowLipLiner] = useState(latestMakeupState.current.showLipLiner);
  const [skinSmooth, setSkinSmooth] = useState(latestMakeupState.current.skinSmooth);
  const [skinSmoothStrength, setSkinSmoothStrength] = useState(latestMakeupState.current.skinSmoothStrength);
  const [eyeBrightness, setEyeBrightness] = useState(latestMakeupState.current.eyeBrightness);
  const [cameraSupported, setCameraSupported] = useState(true);
  const [lowLightWarning, setLowLightWarning] = useState(false);
  const frameCounterRef = useRef(0);
  const latestLandmarksRef = useRef(null);
  const layerCanvasRef = useRef(null);
  const matteCanvasRef = useRef(null);

  useEffect(() => {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      setCameraSupported(false);
      return;
    }
    const faceMesh = new FaceMesh({
      locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh/${file}`,
    });
    faceMesh.setOptions({
      maxNumFaces: 1,
      refineLandmarks: true,
      minDetectionConfidence: 0.5,
      minTrackingConfidence: 0.5,
    });
    faceMesh.onResults(onResults);

    if (videoRef.current) {
      const camera = new cam.Camera(videoRef.current, {
        onFrame: async () => { await faceMesh.send({ image: videoRef.current }); },
        width: 640,
        height: 480,
      });
      camera.start().catch(() => setCameraSupported(false));

      videoRef.current.addEventListener('loadedmetadata', () => {
        if (canvasRef.current) {
          canvasRef.current.width = videoRef.current.videoWidth;
          canvasRef.current.height = videoRef.current.videoHeight;
        }
      });
    }
    return () => {};
  }, []);

  useEffect(() => {
    latestMakeupState.current = {
      foundationColor, opacity, matte,
      lipColor, blushColor, lipGlossColor, lipGlossOpacity, lipLinerColor,
      showFoundation, showBlush, showLip, showGloss, showLipLiner,
      skinSmooth, skinSmoothStrength, eyeBrightness,
    };
  }, [
    foundationColor, opacity, matte,
    lipColor, blushColor, lipGlossColor, lipGlossOpacity, lipLinerColor,
    showFoundation, showBlush, showLip, showGloss, showLipLiner,
    skinSmooth, skinSmoothStrength, eyeBrightness,
  ]);

  function detectExcessiveShadows(videoEl, landmarks, w, h) {
    const sw = Math.round(w / 4);
    const sh = Math.round(h / 4);
    const frameCanvas = document.createElement('canvas');
    frameCanvas.width = sw; frameCanvas.height = sh;
    const frameCtx = frameCanvas.getContext('2d');
    frameCtx.drawImage(videoEl, 0, 0, sw, sh);
    const maskCanvas = document.createElement('canvas');
    maskCanvas.width = sw; maskCanvas.height = sh;
    const maskCtx = maskCanvas.getContext('2d');
    maskCtx.fillStyle = '#000000';
    maskCtx.fillRect(0, 0, sw, sh);
    maskCtx.fillStyle = '#ffffff';
    fillPathDirect(maskCtx, landmarks, FACE_OVAL, sw, sh);
    const { eyebrowTopY, minX, maxX } = computeFaceBounds(landmarks);
    const topCenter = landmarks[10];
    if (topCenter && minX < 1 && maxX > 0 && eyebrowTopY < 1) {
      const faceWidth = maxX - minX;
      const extendRatio = 0.18;
      const leftX = Math.max(0, (minX - faceWidth * extendRatio)) * sh;
      const rightX = Math.min(1, (maxX + faceWidth * extendRatio)) * sh;
      const bottomY = Math.max(0, eyebrowTopY * sh - FOREHEAD_EXTEND_EYEBROW_OFFSET * sh);
      const topY = Math.max(0, topCenter.y * sh - sh * 0.06);
      maskCtx.fillStyle = '#ffffff';
      maskCtx.beginPath();
      maskCtx.moveTo(leftX, bottomY);
      maskCtx.lineTo(leftX, topY);
      maskCtx.lineTo(rightX, topY);
      maskCtx.lineTo(rightX, bottomY);
      maskCtx.closePath();
      maskCtx.fill();
    }
    const frameData = frameCtx.getImageData(0, 0, sw, sh).data;
    const maskData = maskCtx.getImageData(0, 0, sw, sh).data;
    const n = sw * sh;
    let totalPixels = 0, darkPixels = 0;
    const LUMINANCE_THRESHOLD = 100, DARK_RATIO_THRESHOLD = 0.3;
    for (let i = 0; i < n; i++) {
      const idx = i * 4;
      if (maskData[idx + 3] > 128) {
        totalPixels++;
        const luminance = 0.299 * frameData[idx] + 0.587 * frameData[idx + 1] + 0.114 * frameData[idx + 2];
        if (luminance < LUMINANCE_THRESHOLD) darkPixels++;
      }
    }
    if (totalPixels === 0) return false;
    return (darkPixels / totalPixels) > DARK_RATIO_THRESHOLD;
  }

  function onResults(results) {
    const state = latestMakeupState.current;
    const canvasCtx = canvasRef.current.getContext('2d');
    const width = canvasRef.current.width;
    const height = canvasRef.current.height;
    canvasCtx.save();
    canvasCtx.clearRect(0, 0, width, height);
    canvasCtx.drawImage(videoRef.current, 0, 0, width, height);
    if (results.multiFaceLandmarks) {
      for (const landmarks of results.multiFaceLandmarks) {
        latestLandmarksRef.current = landmarks;
        drawMakeup(canvasCtx, landmarks, state, width, height);
      }
    }
    frameCounterRef.current++;
    if (frameCounterRef.current % 15 === 0 && latestLandmarksRef.current && videoRef.current) {
      setLowLightWarning(detectExcessiveShadows(videoRef.current, latestLandmarksRef.current, width, height));
    }
    const lm = latestLandmarksRef.current;
    if (state.skinSmooth && lm && state.skinSmoothStrength > 0) {
      applySkinSmoothing(canvasCtx, lm, width, height, state.skinSmoothStrength);
    }
    canvasCtx.restore();
  }

  function drawMakeup(ctx, landmarks, state, fw, fh) {
    const {
      foundationColor, opacity, matte, showFoundation,
      lipColor, showLip,
      blushColor, showBlush,
      lipGlossColor, lipGlossOpacity, showGloss,
      lipLinerColor, showLipLiner,
      eyeBrightness,
    } = state;
    const rgbFoundation = hexToRgb(foundationColor);
    if (!rgbFoundation && showFoundation) return;
    const rgbLip = showLip ? hexToRgb(lipColor) : null;
    const rgbBlush = showBlush ? hexToRgb(blushColor) : null;
    const rgbGloss = showGloss ? hexToRgb(lipGlossColor) : null;
    const rgbLipLiner = showLipLiner ? hexToRgb(lipLinerColor) : null;
    const alphaFoundation = Math.max(0, Math.min(1, opacity));
    const alphaMatte = Math.max(0, Math.min(1, matte));

    // ============================================================
    // FOUNDATION LAYER
    // ============================================================
    if (showFoundation && rgbFoundation) {
      const { ovalMinY, ovalMaxY, eyebrowTopY, minX, maxX } = computeFaceBounds(landmarks);
      const topCenter = landmarks[10];

      // 1. Draw foundation on layerCanvas
      const layerCtx = ensureLayerCanvas(layerCanvasRef, fw, fh);
      layerCtx.clearRect(0, 0, fw, fh);
      layerCtx.filter = 'none';

      const solidAlpha = Math.min(1, alphaFoundation * 0.65);
      if (ovalMinY < 1 && ovalMaxY > 0) {
        const grad = layerCtx.createLinearGradient(0, ovalMinY * fh, 0, ovalMaxY * fh);
        grad.addColorStop(0, `rgba(${rgbFoundation.r},${rgbFoundation.g},${rgbFoundation.b},${solidAlpha * 0.1})`);
        grad.addColorStop(0.1, `rgba(${rgbFoundation.r},${rgbFoundation.g},${rgbFoundation.b},${solidAlpha * 0.8})`);
        grad.addColorStop(1, `rgba(${rgbFoundation.r},${rgbFoundation.g},${rgbFoundation.b},${solidAlpha})`);
        layerCtx.fillStyle = grad;
      } else {
        layerCtx.fillStyle = `rgba(${rgbFoundation.r},${rgbFoundation.g},${rgbFoundation.b},${solidAlpha})`;
      }
      fillPath(layerCtx, landmarks, FACE_OVAL, fw, fh);
      layerCtx.fill();

      // Forehead extension (з урахуванням нахилу голови)
      if (topCenter && minX < 1 && maxX > 0 && eyebrowTopY < 1) {
        const faceWidth = maxX - minX;
        const extendRatio = 0.18;
        const leftX = Math.max(0, (minX - faceWidth * extendRatio)) * fw + 45;
        const rightX = Math.min(1, (maxX + faceWidth * extendRatio)) * fw - 45;
        const bottomY = Math.max(0, eyebrowTopY * fh - FOREHEAD_EXTEND_EYEBROW_OFFSET * fh+100);
        const topY = Math.max(0, topCenter.y * fh - fh * 0.045);
        const foreheadAlpha = Math.min(1, solidAlpha * 1.35);

        // Обчислюємо кут нахилу голови за зовнішніми куточками очей
        const leftEyeCorner = landmarks[33];
        const rightEyeCorner = landmarks[263];
        let headAngle = 0;
        if (leftEyeCorner && rightEyeCorner) {
          headAngle = Math.atan2(
            rightEyeCorner.y - leftEyeCorner.y,
            rightEyeCorner.x - leftEyeCorner.x
          );
        }

        // Центр і розміри прямокутника для чола
        const rectWidth = rightX - leftX;
        const rectHeight = bottomY - topY;
        const centerX = (leftX + rightX) / 2;
        const centerY = (topY + bottomY) / 2;

        // Градієнт у локальній системі координат (від низу до верху чола)
        const grad = layerCtx.createLinearGradient(0, rectHeight / 2, 0, -rectHeight / 2);
        grad.addColorStop(0, `rgba(${rgbFoundation.r},${rgbFoundation.g},${rgbFoundation.b},${foreheadAlpha * 0.1})`);
        grad.addColorStop(0.5, `rgba(${rgbFoundation.r},${rgbFoundation.g},${rgbFoundation.b},${foreheadAlpha * 0.5})`);
        grad.addColorStop(1, `rgba(${rgbFoundation.r},${rgbFoundation.g},${rgbFoundation.b},${foreheadAlpha * 1})`);

        layerCtx.save();
        layerCtx.translate(centerX, centerY);
        layerCtx.rotate(headAngle);
        layerCtx.fillStyle = grad;
        layerCtx.beginPath();
        layerCtx.rect(-rectWidth / 2, -rectHeight / 2, rectWidth, rectHeight);
        layerCtx.closePath();
        layerCtx.fill();
        layerCtx.restore();
      }

      // 2. Вирізаємо очі та рот — до блюру
      punchOutEyesMouth(layerCtx, landmarks, fw, fh);

      // 3. Blur via temp canvas
      const blurCanvas = document.createElement('canvas');
      blurCanvas.width = fw; blurCanvas.height = fh;
      const blurCtx = blurCanvas.getContext('2d');
      blurCtx.filter = 'blur(6px)';
      blurCtx.drawImage(layerCanvasRef.current, 0, 0);
      blurCtx.filter = 'none';
      layerCtx.clearRect(0, 0, fw, fh);
      layerCtx.drawImage(blurCanvas, 0, 0);

      // 4. Вирізаємо повторно — після блюру
      punchOutEyesMouth(layerCtx, landmarks, fw, fh);

      // 5. Composite to main canvas — single source-over pass
      ctx.save();
      ctx.globalCompositeOperation = 'source-over';
      ctx.drawImage(layerCanvasRef.current, 0, 0);
      ctx.restore();

      // ── Matte
      if (alphaMatte > 0) {
        const matteCtx = ensureLayerCanvas(matteCanvasRef, fw, fh);
        matteCtx.clearRect(0, 0, fw, fh);
        matteCtx.fillStyle = `rgba(${rgbFoundation.r},${rgbFoundation.g},${rgbFoundation.b},${alphaMatte * alphaFoundation * 0.5})`;
        fillPath(matteCtx, landmarks, FACE_OVAL, fw, fh);
        matteCtx.fill();
        punchOutEyesMouth(matteCtx, landmarks, fw, fh);

        const mBlurCanvas = document.createElement('canvas');
        mBlurCanvas.width = fw; mBlurCanvas.height = fh;
        const mBlurCtx = mBlurCanvas.getContext('2d');
        mBlurCtx.filter = 'blur(4px)';
        mBlurCtx.drawImage(matteCanvasRef.current, 0, 0);
        mBlurCtx.filter = 'none';
        matteCtx.clearRect(0, 0, fw, fh);
        matteCtx.drawImage(mBlurCanvas, 0, 0);
        punchOutEyesMouth(matteCtx, landmarks, fw, fh);

        ctx.save();
        ctx.globalCompositeOperation = 'multiply';
        ctx.drawImage(matteCanvasRef.current, 0, 0);
        ctx.restore();
      }
    }

    // ============================================================
    // LIP LINER
    // ============================================================
    if (showLipLiner && rgbLipLiner) {
      ctx.save();
      ctx.strokeStyle = `rgba(${rgbLipLiner.r},${rgbLipLiner.g},${rgbLipLiner.b},0.3)`;
      ctx.lineWidth = Math.max(1.5, Math.round(fw * 0.004));
      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';
      strokePath(ctx, landmarks, LIPS_UPPER_BORDER_OUTER, fw, fh);
      ctx.stroke();
      strokePath(ctx, landmarks, LIPS_LOWER_BORDER_OUTER, fw, fh);
      ctx.stroke();
      ctx.restore();
    }

    // ============================================================
    // LIP COLOR
    // ============================================================
    if (showLip && rgbLip) {
      ctx.save();
      fillPath(ctx, landmarks, LIPS_LOWER_OUTER, fw, fh);
      ctx.clip('evenodd');
      ctx.globalCompositeOperation = 'multiply';
      ctx.fillStyle = `rgba(${rgbLip.r},${rgbLip.g},${rgbLip.b},0.7)`;
      ctx.fillRect(0, 0, fw, fh);
      ctx.restore();
      ctx.save();
      fillPath(ctx, landmarks, LIPS_UPPER_OUTER, fw, fh);
      ctx.clip('evenodd');
      ctx.globalCompositeOperation = 'multiply';
      ctx.fillStyle = `rgba(${rgbLip.r},${rgbLip.g},${rgbLip.b},0.7)`;
      ctx.fillRect(0, 0, fw, fh);
      ctx.restore();
    }

    // ============================================================
    // BLUSH
    // ============================================================
    if (showBlush && rgbBlush) {
      ctx.save();
      ctx.globalCompositeOperation = 'overlay';
      ctx.fillStyle = `rgba(${rgbBlush.r},${rgbBlush.g},${rgbBlush.b},0.4)`;
      fillPath(ctx, landmarks, BLUSH_LEFT, fw, fh);
      ctx.filter = 'blur(10px)';
      ctx.fill();
      fillPath(ctx, landmarks, BLUSH_RIGHT, fw, fh);
      ctx.filter = 'blur(10px)';
      ctx.fill();
      ctx.filter = 'none';
      ctx.restore();
    }

    // ============================================================
    // LIP GLOSS
    // ============================================================
    if (showGloss && rgbGloss) {
      const alphaGloss = Math.max(0, Math.min(1, lipGlossOpacity));
      if (alphaGloss > 0) {
        const lipLeft = landmarks[61];
        const lipRight = landmarks[291];
        let motionPhase = 0;
        if (lipLeft && lipRight) {
          const dx = lipRight.x - lipLeft.x;
          const dy = lipRight.y - lipLeft.y;
          motionPhase = (Math.atan2(dy, dx) + Math.PI) / (Math.PI * 2);
        }
        const specStrength = alphaGloss * 0.7;
        const drawSpecular = (cx, cy, radius, strength) => {
          const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius);
          grad.addColorStop(0, `rgba(255,255,255,${strength})`);
          grad.addColorStop(0.1, `rgba(255,255,255,${strength * 0.7})`);
          grad.addColorStop(0.3, `rgba(255,255,255,${strength * 0.3})`);
          grad.addColorStop(0.6, `rgba(255,255,255,${strength * 0.08})`);
          grad.addColorStop(1, 'rgba(255,255,255,0)');
          ctx.globalCompositeOperation = 'screen';
          ctx.fillStyle = grad;
          ctx.fillRect(0, 0, fw, fh);
        };
        ctx.save();
        fillPath(ctx, landmarks, LIPS_LOWER_OUTER, fw, fh);
        ctx.clip('evenodd');
        const lipCenter = landmarks[14];
        if (lipCenter) {
          drawSpecular(lipCenter.x * fw + (0.5 - motionPhase) * fw * 0.08,
            Math.max(0, lipCenter.y * fh + (-fw * 0.025 + Math.abs(0.5 - motionPhase) * fw * 0.015)),
            fw * 0.06, specStrength);
        }
        const lipSide = landmarks[17], lipSide2 = landmarks[16];
        if (lipSide) drawSpecular(lipSide.x * fw + (0.5 - motionPhase) * fw * 0.04,
          Math.max(0, lipSide.y * fh - fw * 0.015), fw * 0.04, specStrength * 0.5);
        if (lipSide2) drawSpecular(lipSide2.x * fw - (0.5 - motionPhase) * fw * 0.04,
          Math.max(0, lipSide2.y * fh - fw * 0.01), fw * 0.035, specStrength * 0.35);
        ctx.restore();
        ctx.save();
        fillPath(ctx, landmarks, LIPS_UPPER_OUTER, fw, fh);
        ctx.clip('evenodd');
        const upperLipCenter = landmarks[0];
        if (upperLipCenter) drawSpecular(upperLipCenter.x * fw + (0.5 - motionPhase) * fw * 0.03,
          Math.max(0, upperLipCenter.y * fh - fw * 0.02), fw * 0.03, specStrength * 0.35);
        ctx.restore();
      }
    }

    // ============================================================
    // EYE BRIGHTNESS (білок очей — легке сяйво)
    // ============================================================
    if (eyeBrightness > 0) {
      ctx.save();
      ctx.globalCompositeOperation = 'screen';
      ctx.fillStyle = `rgba(255,255,255,${Math.min(1, eyeBrightness)})`;
      ctx.filter = 'blur(3px)';
      fillPath(ctx, landmarks, LEFT_EYE, fw, fh);
      ctx.fill();
      fillPath(ctx, landmarks, RIGHT_EYE, fw, fh);
      ctx.fill();
      ctx.filter = 'none';
      ctx.restore();
    }
  }

  const takeScreenshot = () => {
    const link = document.createElement('a');
    link.download = 'virtual-try-on.png';
    link.href = canvasRef.current.toDataURL('image/png');
    link.click();
  };

  const [isMobile, setIsMobile] = useState(window.innerWidth < 1024);
  const [activeColorPicker, setActiveColorPicker] = useState(null);

  useEffect(() => {
    const handleResize = () => setIsMobile(window.innerWidth < 1024);
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // ───── Блок "немає камери" ─────
  if (!cameraSupported) {
    return (
      <div className="app-wrapper flex flex-col items-center justify-center min-h-screen bg-gray-900 text-white p-4">
        <div className="max-w-xl w-full bg-red-700/90 border border-red-500 p-6 rounded-lg shadow-xl">
          <h2 className="text-2xl font-bold text-white mb-3">Camera unavailable</h2>
          <p className="text-gray-200 mb-2">Your browser does not currently expose <code className="font-mono text-sm text-white">navigator.mediaDevices.getUserMedia</code>, or camera access is blocked.</p>
          <p className="text-gray-200 mb-2">For phone access, open the app using HTTPS on your local network and use a modern browser that supports camera permissions.</p>
          <p className="text-gray-200">Try connecting with <strong>https://{'<your-local-ip>'}:5173</strong> and accept the certificate prompt if required.</p>
        </div>
      </div>
    );
  }

  // ───── Десктопні контроли ─────
  const controlsContent = (
    <>
      <h3 className="text-2xl font-bold text-center text-pink-300">Virtual Makeover</h3>
      <div className="control-group grid grid-cols-2 gap-2">
        <label className="flex items-center text-sm font-medium text-gray-300 gap-2">
          <input type="checkbox" checked={showFoundation} onChange={(e) => setShowFoundation(e.target.checked)} className="accent-pink-500" /> Foundation
        </label>
        <label className="flex items-center text-sm font-medium text-gray-300 gap-2">
          <input type="checkbox" checked={showBlush} onChange={(e) => setShowBlush(e.target.checked)} className="accent-pink-500" /> Blush
        </label>
        <label className="flex items-center text-sm font-medium text-gray-300 gap-2">
          <input type="checkbox" checked={showLip} onChange={(e) => setShowLip(e.target.checked)} className="accent-pink-500" /> Lipstick
        </label>
        <label className="flex items-center text-sm font-medium text-gray-300 gap-2">
          <input type="checkbox" checked={showLipLiner} onChange={(e) => setShowLipLiner(e.target.checked)} className="accent-pink-500" /> Lip Liner
        </label>
        <label className="flex items-center text-sm font-medium text-gray-300 gap-2">
          <input type="checkbox" checked={showGloss} onChange={(e) => setShowGloss(e.target.checked)} className="accent-pink-500" /> Gloss
        </label>
      </div>
      <div className="control-group">
        <label className="block text-sm font-medium text-gray-300 mb-2">Foundation Shade</label>
        <div className="grid grid-cols-3 gap-2 mb-3">
          {['#f3cfb3', '#e4b38d', '#d3a17e', '#c68e65', '#8d5524', '#5c381a'].map(color => (
            <button key={color} className={`shade-btn w-full h-10 rounded-md border-2 ${foundationColor === color ? 'border-pink-400' : 'border-gray-600'} hover:border-pink-400 transition-all duration-200`} style={{ backgroundColor: color }} onClick={() => setFoundationColor(color)} />
          ))}
        </div>
        <input type="color" value={foundationColor} onChange={(e) => setFoundationColor(e.target.value)} className="w-full h-10 p-1 rounded-md cursor-pointer border border-gray-600 bg-gray-800" title="Custom Foundation Color" />
      </div>
      <div className="control-group">
        <label className="block text-sm font-medium text-gray-300 mb-2">Coverage: {Math.round(opacity * 100)}%</label>
        <input type="range" min="0" max="1" step="0.01" value={opacity} onChange={(e) => setOpacity(parseFloat(e.target.value))} className="w-full h-2 bg-gray-600 rounded-lg appearance-none cursor-pointer range-lg" />
      </div>
      <div className="control-group">
        <label className="block text-sm font-medium text-gray-300 mb-2">Matte Finish: {Math.round(matte * 100)}%</label>
        <input type="range" min="0" max="1" step="0.01" value={matte} onChange={(e) => setMatte(parseFloat(e.target.value))} className="w-full h-2 bg-gray-600 rounded-lg appearance-none cursor-pointer range-lg" />
      </div>
      <div className="control-group">
        <label className="flex items-center text-sm font-medium text-gray-300 mb-2"><input type="checkbox" checked={skinSmooth} onChange={(e) => setSkinSmooth(e.target.checked)} className="mr-2" /> Skin Smoothing</label>
      </div>
      <div className="control-group">
        <label className="block text-sm font-medium text-gray-300 mb-2">Smoothing Strength: {Math.round(skinSmoothStrength * 100)}%</label>
        <input type="range" min="0" max="1" step="0.01" value={skinSmoothStrength} onChange={(e) => setSkinSmoothStrength(parseFloat(e.target.value))} className="w-full h-2 bg-gray-600 rounded-lg appearance-none cursor-pointer range-lg" />
        <p className="text-xs text-gray-400 mt-1">0% = off | 100% = maximum airbrush effect</p>
      </div>
      <div className="control-group">
        <label className="block text-sm font-medium text-gray-300 mb-2">Eye Brightness: {Math.round(eyeBrightness * 100)}%</label>
        <input type="range" min="0" max="1" step="0.01" value={eyeBrightness} onChange={(e) => setEyeBrightness(parseFloat(e.target.value))} className="w-full h-2 bg-gray-600 rounded-lg appearance-none cursor-pointer range-lg" />
        <p className="text-xs text-gray-400 mt-1">Освітлює білок очей для більш сяючого вигляду</p>
      </div>
      <div className="control-group">
        <label className="block text-sm font-medium text-gray-300 mb-2">Lip Liner Color</label>
        <div className="grid grid-cols-3 gap-2 mb-3">
          {['#8B0000', '#A0522D', '#CD5C5C', '#800020', '#483C32', '#660000'].map(color => (
            <button key={color} className={`shade-btn w-full h-10 rounded-md border-2 ${lipLinerColor === color ? 'border-pink-400' : 'border-gray-600'} hover:border-pink-400 transition-all duration-200`} style={{ backgroundColor: color }} onClick={() => setLipLinerColor(color)} />
          ))}
        </div>
        <input type="color" value={lipLinerColor} onChange={(e) => setLipLinerColor(e.target.value)} className="w-full h-10 p-1 rounded-md cursor-pointer border border-gray-600 bg-gray-800" title="Custom Lip Liner Color" />
      </div>
      <div className="control-group">
        <label className="block text-sm font-medium text-gray-300 mb-2">Lip Color</label>
        <div className="grid grid-cols-3 gap-2 mb-3">
          {['#BC4E35', '#BD2846', '#EE82EE', '#EE606E', '#CF5B66', '#F2F8FD'].map(color => (
            <button key={color} className={`shade-btn w-full h-10 rounded-md border-2 ${lipColor === color ? 'border-pink-400' : 'border-gray-600'} hover:border-pink-400 transition-all duration-200`} style={{ backgroundColor: color }} onClick={() => setLipColor(color)} />
          ))}
        </div>
        <input type="color" value={lipColor} onChange={(e) => setLipColor(e.target.value)} className="w-full h-10 p-1 rounded-md cursor-pointer border border-gray-600 bg-gray-800" title="Custom Lip Color" />
      </div>
      <div className="control-group">
        <label className="block text-sm font-medium text-gray-300 mb-2">Blush Color</label>
        <div className="grid grid-cols-3 gap-2 mb-3">
          {['#FF9999', '#FFCCCC', '#F08080', '#CD5C5C', '#E9967A', '#FFA07A'].map(color => (
            <button key={color} className={`shade-btn w-full h-10 rounded-md border-2 ${blushColor === color ? 'border-pink-400' : 'border-gray-600'} hover:border-pink-400 transition-all duration-200`} style={{ backgroundColor: color }} onClick={() => setBlushColor(color)} />
          ))}
        </div>
        <input type="color" value={blushColor} onChange={(e) => setBlushColor(e.target.value)} className="w-full h-10 p-1 rounded-md cursor-pointer border border-gray-600 bg-gray-800" title="Custom Blush Color" />
      </div>
      <div className="flex flex-col gap-4 mt-auto">
        <button onClick={takeScreenshot} className="w-full py-2 px-4 bg-green-500 hover:bg-green-600 rounded-md font-semibold transition-all duration-200">Take Screenshot</button>
      </div>
    </>
  );

  const videoCanvas = (
    <>
      <video ref={videoRef} style={{ display: 'none' }} autoPlay muted playsInline />
      <canvas ref={canvasRef} width="640" height="480" />
    </>
  );

  // ───── Foundation tones picker ─────
  const [showFoundationTones, setShowFoundationTones] = useState(false);

  const foundationTonesPanel = (
    <div className="foundation-tones-overlay" onClick={() => setShowFoundationTones(false)}>
      <div className="foundation-tones-sheet" onClick={(e) => e.stopPropagation()}>
        <div className="foundation-tones-header">
          <h3>Тональний крем</h3>
          <button className="foundation-tones-close" onClick={() => setShowFoundationTones(false)}>✕</button>
        </div>
        <div className="foundation-tones-grid">
          {foundationTones.map(tone => (
            <button
              key={tone.sku}
              className={`foundation-tone-btn ${foundationColor === tone.hex ? 'selected' : ''}`}
              onClick={() => {
                setFoundationColor(tone.hex);
                setShowFoundationTones(false);
              }}
            >
              <span className="foundation-tone-circle" style={{ backgroundColor: tone.hex }} />
              <span className="foundation-tone-number">{tone.number}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );

  const pickerMeta = {
    foundation: { title: 'Тональний крем', currentColor: foundationColor, setColor: setFoundationColor, swatches: ['#f3cfb3', '#e4b38d', '#d3a17e', '#c68e65', '#8d5524', '#5c381a', '#3e2211', '#f5e0cc'], show: showFoundation, toggle: () => setShowFoundation(v => !v) },
    blush: { title: "Рум'яна", currentColor: blushColor, setColor: setBlushColor, swatches: ['#FF9999', '#FFCCCC', '#F08080', '#CD5C5C', '#E9967A', '#FFA07A', '#FFB6C1', '#FF69B4'], show: showBlush, toggle: () => setShowBlush(v => !v) },
    lip: { title: 'Помада', currentColor: lipColor, setColor: setLipColor, swatches: ['#CC3333', '#FF6699', '#EE82EE', '#A0522D', '#8B0000', '#FFD700', '#DC143C', '#C71585'], show: showLip, toggle: () => setShowLip(v => !v) },
    gloss: { title: 'Блиск для губ', currentColor: lipGlossColor, setColor: setLipGlossColor, swatches: ['#FFD6E8', '#FFD700', '#FFE4B5', '#F5DEB3', '#E0F0FF', '#FFC0CB', '#DDA0DD', '#FFF0F5'], show: showGloss, toggle: () => setShowGloss(v => !v) },
    lipLiner: { title: 'Контур для губ', currentColor: lipLinerColor, setColor: setLipLinerColor, swatches: ['#8B0000', '#A0522D', '#CD5C5C', '#800020', '#483C32', '#660000', '#4A0404', '#2C1608'], show: showLipLiner, toggle: () => setShowLipLiner(v => !v) },
  };

  const activePicker = activeColorPicker ? pickerMeta[activeColorPicker] : null;

  const colorPickerOverlay = activePicker && (
    <div className="color-picker-overlay" onClick={() => setActiveColorPicker(null)}>
      <div className="color-picker-sheet" onClick={(e) => e.stopPropagation()}>
        <div className="color-picker-header">
          <h3>{activePicker.title}</h3>
          <button className="color-picker-close" onClick={() => setActiveColorPicker(null)}>✕</button>
        </div>
        <div className="color-grid">
          {activePicker.swatches.map(color => (
            <button key={color} className={`color-swatch ${activePicker.currentColor === color ? 'selected' : ''}`} style={{ backgroundColor: color }} onClick={() => { activePicker.setColor(color); setActiveColorPicker(null); }} />
          ))}
        </div>
        <div className="custom-color-row">
          <label>Свій колір</label>
          <input type="color" value={activePicker.currentColor} onChange={(e) => { activePicker.setColor(e.target.value); setActiveColorPicker(null); }} />
        </div>
        <div className="bottom-actions">
          <button className="btn-compare" onClick={() => { activePicker.toggle(); setActiveColorPicker(null); }}>{activePicker.show ? 'Прибрати шар' : 'Показати шар'}</button>
          <button className="btn-screenshot" onClick={() => { takeScreenshot(); setActiveColorPicker(null); }}>Фото</button>
        </div>
      </div>
    </div>
  );

  if (isMobile) {
    return (
      <div className="mobile-layout">
        <div className="video-area">{videoCanvas}</div>
        {lowLightWarning && (
          <div className="shadow-warning shadow-warning-overlay"><span>⚠️</span> Недостатньо світла — додайте освітлення для точного підбору тону</div>
        )}
        <div className="controls-panel">
          <div className="color-buttons">
            <div className="color-btn-wrapper">
              <button className={`color-btn color-btn-foundation ${activeColorPicker === 'foundation' || showFoundationTones ? 'active' : ''}`} style={{ border: `5px solid ${foundationColor}` }} onClick={() => setShowFoundationTones(true)} />
              <span className="color-btn-label">Foundation</span>
            </div>
            <div className="color-btn-wrapper">
              <button className={`color-btn color-btn-blush ${activeColorPicker === 'blush' ? 'active' : ''}`} style={{ border: `5px solid ${blushColor}` }} onClick={() => setActiveColorPicker(activeColorPicker === 'blush' ? null : 'blush')} />
              <span className="color-btn-label">Blush</span>
            </div>
            <div className="color-btn-wrapper">
              <button className={`color-btn color-btn-lip ${activeColorPicker === 'lip' ? 'active' : ''}`} style={{ border: `5px solid ${lipColor}` }} onClick={() => setActiveColorPicker(activeColorPicker === 'lip' ? null : 'lip')} />
              <span className="color-btn-label">Lipstick</span>
            </div>
            <div className="color-btn-wrapper">
              <button className={`color-btn color-btn-liner ${activeColorPicker === 'lipLiner' ? 'active' : ''}`} style={{ border: `5px solid ${lipLinerColor}` }} onClick={() => setActiveColorPicker(activeColorPicker === 'lipLiner' ? null : 'lipLiner')} />
              <span className="color-btn-label">Liner</span>
            </div>
          </div>
        </div>
        {activeColorPicker && activeColorPicker !== 'foundation' && colorPickerOverlay}
        {showFoundationTones && foundationTonesPanel}
      </div>
    );
  }

  return (
    <div className="desktop-layout min-h-screen bg-gray-900 text-white p-4">
      <div className="main-content flex flex-col lg:flex-row items-center gap-8 bg-gray-800 p-6 rounded-lg shadow-xl max-w-6xl mx-auto">
        <div className="side-panel flex flex-col gap-6 w-full lg:w-80 bg-gray-700 p-5 rounded-lg order-1 lg:order-2">
          {lowLightWarning && <div className="shadow-warning"><span>⚠️</span> Недостатньо світла — додайте освітлення для точного підбору тону</div>}
          {controlsContent}
        </div>
        <div className="flex justify-center lg:justify-start w-full lg:w-auto order-2 lg:order-1">
          <div className="container relative w-full max-w-[90vw] sm:max-w-[640px] h-auto bg-gray-900 rounded-lg overflow-hidden">
            {videoCanvas}
          </div>
        </div>
      </div>
      <div className="info-panel mt-4 p-3 bg-gray-800 rounded-lg shadow-xl w-full max-w-[90vw] sm:max-w-6xl mx-auto">
        <p className="text-sm text-gray-400 text-center">🎯 Advanced skin smoothing — applies a selective feathered airbrush effect to skin only, preserving eyes, brows, nose, lips, and facial features.</p>
      </div>
    </div>
  );
}

export default App;
