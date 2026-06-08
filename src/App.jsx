import React, { useEffect, useRef, useState } from 'react';
import { applySkinSmoothing } from './skinSmoothing';
import foundationsData from './datasets/foundations.json';
import blushData from './datasets/blush.json';
import lipsticksData from './datasets/lipsticks.json';
import liplinerData from './datasets/lipliner.json';

// ─── Module-level caches to prevent duplicate initialization ───
// 1. FaceMesh instance caching — creating a new FaceMesh() each mount triggers
//    locateFile to re-load WASM/internal assets (face_mesh_solution_* etc.)
// 2. Camera started flag — prevents camera.start() (which calls getUserMedia)
//    from being invoked more than once, avoiding multiple browser permission prompts
let faceMeshInstance = null;
let cameraStarted = false;

function getFaceMesh() {
  if (!faceMeshInstance) {
    if (!window.FaceMesh) {
      console.error("MediaPipe FaceMesh не завантажився з CDN!");
      return null;
    }
    faceMeshInstance = new window.FaceMesh({
      locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh/${file}`
    });
  }
  return faceMeshInstance;
}

const FOREHEAD_EXTEND_EYEBROW_OFFSET = 0.01;

// ─────── Temporal landmark smoothing (low-pass filter for jitter reduction) ───────
// Експоненційне ковзне середнє (EWMA) для усунення тремтіння лендмарків між кадрами.
// Lower alpha = smoother but more lag; higher alpha = more responsive but more jitter
const LANDMARK_SMOOTHING_ALPHA = 1;

// ─────── Константи чутливості детектора якості відео ───────
// LUMINANCE_THRESHOLD: якщо яскравість пікселя нижче — вважається темним
// DARK_RATIO_THRESHOLD: якщо відсоток темних пікселів на обличчі вище — недостатньо світла
// NOISE_GRADIENT_THRESHOLD: якщо середній градієнт між сусідніми пікселями вище — занадто зернисто (високе ISO)
const LUMINANCE_THRESHOLD = 110;
const DARK_RATIO_THRESHOLD = 0.35;
const NOISE_GRADIENT_THRESHOLD = 11;

// ─────── Модульні константи (лендмарки) ───────
const FACE_OVAL = [
  10, 338, 297, 332, 284, 251, 389, 356, 454, 323, 361, 288,
  397, 365, 379, 378, 400, 377, 152, 148, 176, 149, 150, 136,
  172, 58, 132, 93, 234, 127, 162, 21, 54, 103, 67, 109,
];
const LIPS_UPPER_OUTER = [61, 185, 40, 39, 37, 0, 267, 269, 270, 409, 291];
const LIPS_LOWER_OUTER = [61, 146, 91, 181, 84, 17, 314, 405, 321, 375, 291];
const LIPS_UPPER = [61, 185, 40, 39, 37, 0, 267, 269, 270, 409, 291, 308, 415, 310, 311, 312, 13, 82, 81, 80, 191, 78];
const LIPS_LOWER = [61, 146, 91, 181, 84, 17, 314, 405, 321, 375, 291, 308, 324, 318, 402, 317, 14, 87, 178, 88, 95, 78];
const LIPS_UPPER_BORDER_OUTER = [61, 185, 40, 39, 37, 0, 267, 269, 270, 409, 291, 409, 270, 269, 267, 0, 37, 39, 40, 185, 61];
const LIPS_LOWER_BORDER_OUTER = [61, 146, 91, 181, 84, 17, 314, 405, 321, 375, 291, 375, 321, 405, 314, 17, 84, 181, 91, 146, 61];
const LEFT_EYE = [33, 7, 163, 144, 145, 153, 154, 155, 133, 173, 157, 158, 159, 160, 161, 246];
const RIGHT_EYE = [263, 249, 390, 373, 374, 380, 381, 382, 362, 398, 384, 385, 386, 387, 388, 466];
const LEFT_EYEBROW = [70, 63, 105, 66, 107, 55, 65, 52, 53, 46];
const RIGHT_EYEBROW = [300, 293, 334, 296, 336, 285, 295, 282, 283, 276];
const BLUSH_LEFT = [116, 117, 118, 119, 120, 121, 128, 50, 205, 49, 110, 203, 204];
const BLUSH_RIGHT = [345, 346, 347, 348, 349, 350, 357, 280, 425, 279, 339, 423, 424];
const LEFT_IRIS = [468, 469, 470, 471, 472];
const RIGHT_IRIS = [473, 474, 475, 476, 477];
// ─────── Skin sampling landmarks for auto-foundation matching ───────
// Лендмарки на чистій шкірі (щоки, лоб) для забору зразків кольору
const SKIN_CHEEK_LEFT = [50, 205, 213, 216, 217, 49, 206, 207, 208, 209];
const SKIN_CHEEK_RIGHT = [280, 425, 426, 436, 279, 422, 423, 424, 266];
const SKIN_FOREHEAD = [109, 67, 108, 10, 337, 299, 338, 297];
const SKIN_SAMPLE_GROUPS = [SKIN_CHEEK_LEFT, SKIN_CHEEK_RIGHT, SKIN_FOREHEAD];
// Внутрішній контур рота (простір між губами — зуби, порожнина рота)
const MOUTH_INTERIOR = [78, 191, 80, 81, 82, 13, 312, 311, 310, 415, 308, 324, 318, 402, 317, 14, 87, 178, 88, 95, 78];

// Всі унікальні індекси лендмарків, що стосуються губ (губи + контур + внутрішній рот)
const LIP_INDICES = new Set([
  0, 13, 14, 17, 37, 39, 40, 61, 78, 80, 81, 82, 84, 87, 88, 91, 95,
  146, 178, 181, 185, 191, 267, 269, 270, 291, 308, 310, 311, 312, 314,
  317, 318, 321, 324, 375, 402, 405, 409, 415
]);
const ALL_BROWS = [...LEFT_EYEBROW, ...RIGHT_EYEBROW];
// Вирізається: очі (щоб не фарбувались), внутрішня частина рота (зуби/порожнина),
// верхня та нижня губа — тональник не має зафарбовувати губи.
const CUTOUT_GROUPS = [
  LEFT_EYE, RIGHT_EYE,
  MOUTH_INTERIOR,
  LIPS_UPPER_OUTER,
  LIPS_LOWER_OUTER,
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
  return { sku: item.sku, hex, number, default: item.default || false };
});

// Підготовлені дані для blush
const blushTones = blushData.map(item => {
  const hex = rgbStrToHex(item.background);
  return { sku: item.sku, hex, name: item.name, default: item.default || false };
});

// Підготовлені дані для помади
const lipstickTones = lipsticksData.map(item => {
  const hex = rgbStrToHex(item.background);
  return { sku: item.sku, hex, name: item.name, default: item.default || false };
});

// Підготовлені дані для олівця для губ
const liplinerTones = liplinerData.map(item => {
  const hex = rgbStrToHex(item.background);
  return { sku: item.sku, hex, name: item.name, default: item.default || false };
});

// ───── Розділення тонів на зони, якщо передано product-sku ─────
function computeToneZones(tones, targetSku) {
  if (!targetSku) return null;

  const index = tones.findIndex(t => t.sku === targetSku);
  if (index === -1) return null;

  // Safe zone — тільки знайдений тон
  const safeZone = [tones[index]];

  // Green zone — 2 тони до та 2 тони після
  const before = tones.slice(Math.max(0, index - 2), index);
  const after = tones.slice(index + 1, index + 3);
  const greenZone = [...before, ...after];

  // Unpredictable zone — всі тони, крім тих, що в safe та green
  const excludedIndices = new Set([
    index,
    ...Array.from({ length: before.length }, (_, i) => index - before.length + i),
    ...Array.from({ length: after.length }, (_, i) => index + 1 + i),
  ]);
  const unpredictableZone = tones.filter((_, i) => !excludedIndices.has(i));

  return { safeZone, greenZone, unpredictableZone, selectedIndex: index };
}

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

// ─────── Color distance function (weighted RGB with emphasis on warmth) ───────
function colorDistance(c1, c2) {
  // Зважена евклідова відстань: більша вага на червоний і зелений (важливо для тону шкіри)
  const dr = c1.r - c2.r;
  const dg = c1.g - c2.g;
  const db = c1.b - c2.b;
  // Червоний і зелений — ключові для тону шкіри, синій менш важливий
  return dr * dr * 0.45 + dg * dg * 0.35 + db * db * 0.2;
}

// ─────── Auto-foundation match: sample skin from video, find closest tone ───────
// Повертає { hex, sku, number } — найкращий збіг з foundationTones
function findBestFoundationMatch(videoEl, landmarks, w, h) {
  // Малюємо поточний кадр на тимчасовому канвасі
  const tempCanvas = document.createElement('canvas');
  tempCanvas.width = w;
  tempCanvas.height = h;
  const tempCtx = tempCanvas.getContext('2d');
  tempCtx.drawImage(videoEl, 0, 0, w, h);
  const imageData = tempCtx.getImageData(0, 0, w, h).data;

  // Збираємо зразки з КОЖНОЇ групи окремо, щоб виявити затінені ділянки
  // Кожна група: { samples: [{r,g,b}], avgLum: number }
  const groupResults = [];
  for (const group of SKIN_SAMPLE_GROUPS) {
    const groupSamples = [];
    for (const idx of group) {
      const lm = landmarks[idx];
      if (!lm) continue;
      const px = Math.round(lm.x * w);
      const py = Math.round(lm.y * h);
      if (px < 0 || px >= w || py < 0 || py >= h) continue;
      const pos = (py * w + px) * 4;
      const r = imageData[pos];
      const g = imageData[pos + 1];
      const b = imageData[pos + 2];
      // Фільтруємо надто темні/світлі пікселі (тіні/відблиски)
      const lum = 0.299 * r + 0.587 * g + 0.114 * b;
      if (lum < 40 || lum > 240) continue;
      groupSamples.push({ r, g, b });
    }
    if (groupSamples.length < 2) continue; // недостатньо зразків у групі

    // Середня яскравість групи
    let sumLum = 0;
    for (const s of groupSamples) {
      sumLum += 0.299 * s.r + 0.587 * s.g + 0.114 * s.b;
    }
    groupResults.push({
      samples: groupSamples,
      avgLum: sumLum / groupSamples.length,
    });
  }

  if (groupResults.length === 0) return null;

  // Усереднюємо ВСІ групи, а не тільки найяскравіші.
  // Це дає більш природний, усереднений тон шкіри замість
  // цілеспрямованого висвітлення по максимуму.
  const selectedSamples = groupResults.flatMap(gr => gr.samples);

  if (selectedSamples.length < 3) return null;

  // Усереднюємо зразки
  let avgR = 0, avgG = 0, avgB = 0;
  for (const s of selectedSamples) {
    avgR += s.r;
    avgG += s.g;
    avgB += s.b;
  }
  avgR = Math.round(avgR / selectedSamples.length);
  avgG = Math.round(avgG / selectedSamples.length);
  avgB = Math.round(avgB / selectedSamples.length);
  const skinAvg = { r: avgR, g: avgG, b: avgB };

  // Знаходимо найближчий тон з foundationTones
  let bestDist = Infinity;
  let bestMatch = null;
  for (const tone of foundationTones) {
    const rgb = hexToRgb(tone.hex);
    if (!rgb) continue;
    const dist = colorDistance(skinAvg, rgb);
    if (dist < bestDist) {
      bestDist = dist;
      bestMatch = tone;
    }
  }

  return bestMatch;
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

// Вирізає очі, внутрішню частину рота (зуби/порожнину) та губи з шару тональника.
// Тональник не має зафарбовувати губи — вони вирізаються через destination-out,
// а помада наноситься зверху через multiply.
function punchOutEyesMouth(ctx, landmarks, fw, fh) {
  ctx.save();
  ctx.globalCompositeOperation = 'destination-out';
  ctx.fillStyle = 'rgba(0,0,0,1)';
  ctx.strokeStyle = 'rgba(0,0,0,1)';
  ctx.lineWidth = 2;
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

// ───── Читаємо SKU з URL (якщо передано) — лише читання, без запису ─────
function getProductSkuFromUrl(key) {
  const params = new URLSearchParams(window.location.search);
  return params.get(key);
}

// ───── Отримуємо дефолтний колір тону: props (HTML-атрибути) > URL > default:true ─────
function resolveSku(skuFromProps, paramName) {
  return skuFromProps || getProductSkuFromUrl(paramName) || undefined;
}

function getDefaultFoundationColor(foundationProductSku) {
  const sku = resolveSku(foundationProductSku, 'foundation-product-sku');
  if (sku) {
    const found = foundationTones.find(t => t.sku === sku);
    if (found) return found.hex;
  }
  const def = foundationTones.find(t => t.default);
  return def ? def.hex : foundationTones[0]?.hex || '#f3cfb3';
}

// ───── Resolve recommended-foundation-sku: props > URL param ─────
function resolveRecomendedSku(recomendedFromProps) {
  return recomendedFromProps || getProductSkuFromUrl('recomended-foundation-sku') || undefined;
}

function getDefaultBlushColor(blushProductSku) {
  const sku = resolveSku(blushProductSku, 'blush-product-sku');
  if (sku) {
    const found = blushTones.find(t => t.sku === sku);
    if (found) return found.hex;
  }
  const def = blushTones.find(t => t.default);
  return def ? def.hex : blushTones[0]?.hex || '#f3bebe';
}

function getDefaultLipstickColor(lipstickProductSku) {
  const sku = resolveSku(lipstickProductSku, 'lipstick-product-sku');
  if (sku) {
    const found = lipstickTones.find(t => t.sku === sku);
    if (found) return found.hex;
  }
  const def = lipstickTones.find(t => t.default);
  return def ? def.hex : lipstickTones[0]?.hex || '#BD2846';
}

function getDefaultLiplinerColor(liplinerProductSku) {
  const sku = resolveSku(liplinerProductSku, 'lipliner-product-sku');
  if (sku) {
    const found = liplinerTones.find(t => t.sku === sku);
    if (found) return found.hex;
  }
  const def = liplinerTones.find(t => t.default);
  return def ? def.hex : liplinerTones[0]?.hex || '#390404';
}

// ────────── Основний компонент ──────────
function App({ foundationProductSku, blushProductSku, lipstickProductSku, liplinerProductSku, recomendedFoundationSku }) {
  // ───── Resolve recommended-foundation-sku ─────
  const recomendedSku = resolveRecomendedSku(recomendedFoundationSku);
  const isSingleProductView = !!recomendedSku;

  // Якщо є рекомендований SKU — використовуємо його колір як безумовний дефолт
  let defaultFoundationColor = getDefaultFoundationColor(foundationProductSku);
  if (recomendedSku) {
    const found = foundationTones.find(t => t.sku === recomendedSku);
    if (found) {
      defaultFoundationColor = found.hex;
    }
  }
  const defaultBlushColor = getDefaultBlushColor(blushProductSku);
  const defaultLipstickColor = getDefaultLipstickColor(lipstickProductSku);
  const defaultLiplinerColor = getDefaultLiplinerColor(liplinerProductSku);
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  // У single-product view (recomended-foundation-sku) не малюємо blush, помаду, контур
  const initShowBlush = !isSingleProductView;
  const initShowLip = !isSingleProductView;
  const initShowLipLiner = !isSingleProductView;

  const latestMakeupState = useRef({
    foundationColor: defaultFoundationColor,
    opacity: 0.39,
    matte: 0.46,
    lipColor: defaultLipstickColor,
    blushColor: defaultBlushColor,
    lipGlossColor: '#310606',
    lipGlossOpacity: 0.19,
    lipLinerColor: defaultLiplinerColor,
    showFoundation: true,
    showBlush: initShowBlush,
    showLip: initShowLip,
    showGloss: false,
    showLipLiner: initShowLipLiner,
    skinSmooth: true,
    skinSmoothStrength: 0.32,
    eyeBrightness: 0.05,
  });

  const [foundationColor, setFoundationColor] = useState(defaultFoundationColor);

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
  const [showSideLighting, setShowSideLighting] = useState(false);
  const [autoMatching, setAutoMatching] = useState(false);
  const [showAutoMatch, setShowAutoMatch] = useState(false);
  const [showAutoMatchPopup, setShowAutoMatchPopup] = useState(false);
  const [autoMatchResult, setAutoMatchResult] = useState(null);
  const autoMatchTimerRef = useRef(null);

  // ───── Auto-foundation match popup handler ─────
  // Спочатку показуємо попап з інструкцією
  const handleAutoMatchClick = () => {
    if (lowLightWarningRef.current) return;
    setShowAutoMatchPopup(true);
  };

  // Якщо користувач підтвердив — запускаємо автопідбір
  const confirmAutoMatch = () => {
    setShowAutoMatchPopup(false);
    // Даємо React час закрити попап перед запуском
    setTimeout(() => {
      handleAutoMatchInternal();
    }, 50);
  };

  // Якщо користувач скасував — просто закриваємо попап
  const cancelAutoMatch = () => {
    setShowAutoMatchPopup(false);
  };

  // ───── Auto-foundation match handler ─────
  const handleAutoMatchInternal = () => {
    const lm = latestLandmarksRef.current;
    const video = videoRef.current;
    if (!lm || !video || !canvasRef.current) return;
    if (lowLightWarningRef.current) return;

    setAutoMatching(true);
    setShowAutoMatch(false);

    // Невелика затримка, щоб кадр встиг оновитись
    setTimeout(() => {
      try {
        const width = canvasRef.current.width;
        const height = canvasRef.current.height;
        const match = findBestFoundationMatch(video, lm, width, height);
        if (match) {
          setFoundationColor(match.hex);
          setShowFoundation(true);
          setAutoMatchResult({ sku: match.sku, hex: match.hex, number: match.number });
          setShowAutoMatch(true);

          // Автоматично приховуємо сповіщення через 5 секунд
          if (autoMatchTimerRef.current) clearTimeout(autoMatchTimerRef.current);
          autoMatchTimerRef.current = setTimeout(() => {
            setShowAutoMatch(false);
          }, 5000);
        } else {
          setAutoMatchResult(null);
          setShowAutoMatch(true);
          if (autoMatchTimerRef.current) clearTimeout(autoMatchTimerRef.current);
          autoMatchTimerRef.current = setTimeout(() => {
            setShowAutoMatch(false);
          }, 3000);
        }
      } catch (e) {
        console.error('Auto match error:', e);
      } finally {
        setAutoMatching(false);
      }
    }, 300);
  };

  const [cameraSupported, setCameraSupported] = useState(true);
  const [lowLightWarning, setLowLightWarning] = useState(false);
  const lowLightWarningRef = useRef(false); // синхронізується з lowLightWarning для використання в onResults (closure)
  const frameCounterRef = useRef(0);
  const latestLandmarksRef = useRef(null);
  const layerCanvasRef = useRef(null);
  const matteCanvasRef = useRef(null);
  const smoothedLandmarksRef = useRef(null);
  const isFirstFrameRef = useRef(true);
  // Реф для зберігання екземплярів FaceMesh та Camera (для коректного cleanup)
  const faceMeshRef = useRef(null);
  const cameraRef = useRef(null);
  // Кешовані канваси для аналізу якості відео (щоб не створювати щокадру)
  const _detectCanvasRef = useRef(null);
  const _detectMaskRef = useRef(null);
  // Кешовані канваси для foundation blur (не створюємо нові щокадру)
  const _fbBlurRef = useRef(null);
  const _fbMatteBlurRef = useRef(null);
  // Кешовані дані computeFaceBounds (одна обчислення на кадр)
  const _cachedBoundsRef = useRef(null);


  // ───── Temporal smoothing for landmarks (low-pass filter / EWMA) ─────
  // Застосовує експоненційне ковзне середнє ТІЛЬКИ до лендмарків губ і контуру губ,
  // щоб усунути тремтіння від кадру до кадру: smoothed = prev + alpha * (raw - prev)
  // Інші лендмарки (обличчя, очі, брови, рум'яна тощо) залишаються raw (без згладжування).
  function smoothLandmarks(rawLandmarks) {
    if (isFirstFrameRef.current || !smoothedLandmarksRef.current) {
      // Перший кадр — копіюємо як є
      smoothedLandmarksRef.current = rawLandmarks.map(lm => ({ x: lm.x, y: lm.y, z: lm.z }));
      isFirstFrameRef.current = false;
      return smoothedLandmarksRef.current;
    }

    const prev = smoothedLandmarksRef.current;
    const alpha = LANDMARK_SMOOTHING_ALPHA;
    const oneMinusAlpha = 1 - alpha;

    // Згладжуємо тільки лендмарки губ і контуру губ (LIP_INDICES)
    for (const i of LIP_INDICES) {
      if (i < rawLandmarks.length) {
        prev[i].x = prev[i].x * oneMinusAlpha + rawLandmarks[i].x * alpha;
        prev[i].y = prev[i].y * oneMinusAlpha + rawLandmarks[i].y * alpha;
        if (rawLandmarks[i].z !== undefined) {
          prev[i].z = prev[i].z * oneMinusAlpha + rawLandmarks[i].z * alpha;
        }
      }
    }
    // Для всіх інших лендмарків — копіюємо raw значення (без згладжування)
    for (let i = 0; i < rawLandmarks.length; i++) {
      if (!LIP_INDICES.has(i)) {
        prev[i].x = rawLandmarks[i].x;
        prev[i].y = rawLandmarks[i].y;
        if (rawLandmarks[i].z !== undefined) {
          prev[i].z = rawLandmarks[i].z;
        }
      }
    }
    return prev;
  }

  // ───── Скидання згладжування при виявленні різкого стрибка голови ─────
  function detectAndResetOnJump(rawLandmarks) {
    if (!smoothedLandmarksRef.current || rawLandmarks.length < 2) return false;
    const prev = smoothedLandmarksRef.current;
    // Використовуємо центр носа (landmark 1) як стабільний орієнтир
    const dx = rawLandmarks[1].x - prev[1].x;
    const dy = rawLandmarks[1].y - prev[1].y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    // Якщо стрибок > 12% — це реальний рух, а не шум → скидаємо фільтр
    if (dist > 0.12) {
      isFirstFrameRef.current = true;
      return true;
    }
    return false;
  }

  useEffect(() => {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      setCameraSupported(false);
      return;
    }
    const faceMesh = getFaceMesh();

    if (!faceMesh) {
      console.error("MediaPipe FaceMesh не завантажився з CDN!");
    }
    faceMeshRef.current = faceMesh;
    faceMesh.setOptions({
      maxNumFaces: 1,
      refineLandmarks: true,
      minDetectionConfidence: 0.5,
      minTrackingConfidence: 0.5,
    });
    faceMesh.onResults(onResults);

    if (videoRef.current) {


      const MediaPipeCamera = window.Camera;

      if (!MediaPipeCamera) {
        console.error("MediaPipe Camera інструменти не завантажилися з CDN!");
      }

      const camera = new MediaPipeCamera(videoRef.current, {
        onFrame: async () => { await faceMesh.send({ image: videoRef.current }); },
        width: 640,
        height: 480,
      });
      cameraRef.current = camera;

      camera.start().catch(() => setCameraSupported(false));

      videoRef.current.addEventListener('loadedmetadata', () => {
        if (canvasRef.current) {
          canvasRef.current.width = videoRef.current.videoWidth;
          canvasRef.current.height = videoRef.current.videoHeight;
        }
      });
    }
    return () => {
      // Зупиняємо камеру та очищаємо ресурси при демонтуванні компонента
      if (cameraRef.current) {
        try {
          cameraRef.current.stop();
        } catch (e) {
          // ігноруємо помилки при зупинці
        }
        cameraRef.current = null;
      }
      faceMeshRef.current = null;
    };

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

  /**
   * Єдина функція аналізу якості відео — об'єднує перевірку тіней та шуму
   * в один прохід по пікселях, з використанням кешованих канвасів.
   * Повертає true якщо затемно або занадто зернисто (високе ISO).
   */
  function detectVideoQuality(videoEl, landmarks, w, h) {
    const sw = Math.round(w / 4);
    const sh = Math.round(h / 4);

    // ── Frame canvas (кешований) ──
    if (!_detectCanvasRef.current || _detectCanvasRef.current.width !== sw || _detectCanvasRef.current.height !== sh) {
      const c = document.createElement('canvas');
      c.width = sw; c.height = sh;
      _detectCanvasRef.current = c;
    }
    const frameCtx = _detectCanvasRef.current.getContext('2d');
    frameCtx.drawImage(videoEl, 0, 0, sw, sh);

    // ── Mask canvas (кешований) ──
    if (!_detectMaskRef.current || _detectMaskRef.current.width !== sw || _detectMaskRef.current.height !== sh) {
      const c = document.createElement('canvas');
      c.width = sw; c.height = sh;
      _detectMaskRef.current = c;
    }
    const maskCtx = _detectMaskRef.current.getContext('2d');
    maskCtx.fillStyle = '#000000';
    maskCtx.fillRect(0, 0, sw, sh);
    maskCtx.fillStyle = '#ffffff';
    fillPathDirect(maskCtx, landmarks, FACE_OVAL, sw, sh);

    // Додаємо лоб до маски
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

    // ════════════════════════════════════════════
    // ЄДИНИЙ ПРОХІД — одночасно шум + тіні
    // ════════════════════════════════════════════
    let darkPixels = 0, totalPixels = 0;
    let totalGradient = 0, sampleCount = 0;
    const blockSize = 4;
    const SW = sw; // локальна копія для швидкості

    for (let i = 0; i < n; i++) {
      const idx = i * 4;
      if (maskData[idx + 3] <= 128) continue;
      totalPixels++;

      // Luminance для тіней
      const r = frameData[idx];
      const g = frameData[idx + 1];
      const b = frameData[idx + 2];
      const luminance = 0.299 * r + 0.587 * g + 0.114 * b;
      if (luminance < LUMINANCE_THRESHOLD) darkPixels++;

      // Gradient для шуму (кожен blockSize-ий піксель)
      if (sampleCount === 0 || (i % (blockSize * SW)) < blockSize) {
        // Вважаємо один піксель з кожного блоку для градієнта
        const y = Math.floor(i / SW);
        const x = i % SW;
        if (y > 0 && y < sh - 1 && x > 0 && x < sw - 1) {
          let localDiff = 0;
          let localCount = 0;
          for (let dy = -1; dy <= 1; dy++) {
            for (let dx = -1; dx <= 1; dx++) {
              if (dy === 0 && dx === 0) continue;
              const ni = ((y + dy) * SW + (x + dx)) * 4;
              if (maskData[ni + 3] <= 128) continue;
              const nr = frameData[ni];
              const ng = frameData[ni + 1];
              const nb = frameData[ni + 2];
              const lumN = 0.299 * nr + 0.587 * ng + 0.114 * nb;
              localDiff += Math.abs(luminance - lumN);
              localCount++;
            }
          }
          if (localCount > 0) {
            totalGradient += localDiff / localCount;
            sampleCount++;
          }
        }
      }
    }

    // Тіні
    const hasDarkness = totalPixels > 0 && (darkPixels / totalPixels) > DARK_RATIO_THRESHOLD;
    // Шум
    const hasNoise = sampleCount >= 10 && (totalGradient / sampleCount) > NOISE_GRADIENT_THRESHOLD;

    return hasDarkness || hasNoise;
  }

  function onResults(results) {
    const state = latestMakeupState.current;
    const canvasCtx = canvasRef.current.getContext('2d');
    const width = canvasRef.current.width;
    const height = canvasRef.current.height;
    canvasCtx.save();
    canvasCtx.clearRect(0, 0, width, height);
    canvasCtx.drawImage(videoRef.current, 0, 0, width, height);

    if (results.multiFaceLandmarks && results.multiFaceLandmarks.length > 0) {
      const rawLandmarks = results.multiFaceLandmarks[0];
      // ── Завжди оновлюємо лендмарки (для detectVideoQuality) ──
      detectAndResetOnJump(rawLandmarks);
      const smoothed = smoothLandmarks(rawLandmarks);
      latestLandmarksRef.current = smoothed;

      // ── Малюємо макіяж тільки якщо достатньо світла ──
      if (!lowLightWarningRef.current) {
        drawMakeup(canvasCtx, smoothed, state, width, height);
      }
    } else {
      // ── Обличчя пропало з кадру — скидаємо лендмарки та згладжування,
      // щоб не малювати старий макіяж на чистому відео ──
      latestLandmarksRef.current = null;
      smoothedLandmarksRef.current = null;
      isFirstFrameRef.current = true;
    }

    // ── Перевіряємо якість кожні 15 кадрів ──
    frameCounterRef.current++;
    if (frameCounterRef.current % 15 === 0 && latestLandmarksRef.current && videoRef.current) {
      const isBadQuality = detectVideoQuality(videoRef.current, latestLandmarksRef.current, width, height);
      lowLightWarningRef.current = isBadQuality;
      setLowLightWarning(isBadQuality);
    } else if (frameCounterRef.current % 15 === 0 && videoRef.current && !latestLandmarksRef.current) {
      // Обличчя немає — скидаємо попередження (не може бути поганого світла без обличчя)
      lowLightWarningRef.current = false;
      setLowLightWarning(false);
    }

    // ── Skin smoothing тільки при хорошому освітленні та якщо є обличчя ──
    const lm = latestLandmarksRef.current;
    if (state.skinSmooth && lm && state.skinSmoothStrength > 0 && !lowLightWarningRef.current) {
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

      // Розширення маски на чоло: прямокутник, повернутий разом з головою.
      // Ширина — по краях брів (landmarks 46, 276).
      // Нижня межа — нижній край брів + 2% відступ.
      // Верхня межа — на 35% висоти обличчя вище нижньої межі.
      // Кут нахилу — заперечений для дзеркального відео (selfie).
      if (eyebrowTopY < 1) {
        const leftBrowEdge = landmarks[46];
        const rightBrowEdge = landmarks[276];
        const leftEyeCorner = landmarks[33];
        const rightEyeCorner = landmarks[263];

        if (leftBrowEdge && rightBrowEdge && leftEyeCorner && rightEyeCorner) {
          const faceHeight = ovalMaxY - ovalMinY;
          const leftX = leftBrowEdge.x * fw - 10;
          const rightX = rightBrowEdge.x * fw + 10;
          // Нижня межа прив'язана до рівня очей (не брів!) — стабільно
          const eyeMidY = (leftEyeCorner.y + rightEyeCorner.y) / 2;
          const startY = Math.min(fh, (eyeMidY - 0.04) * fh);
          const hairlineY = Math.max(0, startY - faceHeight * fh * 0.35);

          // Кут нахилу голови за зовнішніми куточками очей
          let headAngle = 0;
          if (leftEyeCorner && rightEyeCorner) {
            headAngle = Math.atan2(
              rightEyeCorner.y - leftEyeCorner.y,
              rightEyeCorner.x - leftEyeCorner.x
            );
          }

          const centerX = (leftX + rightX) / 2;
          const centerY = (startY + hairlineY) / 2;
          const rectWidth = rightX - leftX;
          const rectHeight = startY - hairlineY;

          // Градієнт у локальній системі (від низу до верху)
          const grad = layerCtx.createLinearGradient(0, rectHeight / 2, 0, -rectHeight / 2);
          grad.addColorStop(0, `rgba(${rgbFoundation.r},${rgbFoundation.g},${rgbFoundation.b},${solidAlpha * 0.3})`);
          grad.addColorStop(0.1, `rgba(${rgbFoundation.r},${rgbFoundation.g},${rgbFoundation.b},${solidAlpha * 0.8})`);
          grad.addColorStop(0.2, `rgba(${rgbFoundation.r},${rgbFoundation.g},${rgbFoundation.b},${solidAlpha})`);
          grad.addColorStop(1, `rgba(${rgbFoundation.r},${rgbFoundation.g},${rgbFoundation.b},${solidAlpha})`);

          layerCtx.save();
          layerCtx.translate(centerX, centerY);
          layerCtx.rotate(headAngle);
          layerCtx.fillStyle = grad;
          const borderRadius = rectWidth * 0.35;
          layerCtx.roundRect(
            -rectWidth / 2,
            -rectHeight / 2,
            rectWidth,
            rectHeight,
            [borderRadius, borderRadius, 0, 0]
          );
          layerCtx.fill();
          layerCtx.restore();
        }
      }

      // 2. Вирізаємо очі та рот — до блюру
      punchOutEyesMouth(layerCtx, landmarks, fw, fh);

      // 3. Blur via cached temp canvas (clear first — blur filter creates semi-transparent edges)
      if (!_fbBlurRef.current || _fbBlurRef.current.width !== fw || _fbBlurRef.current.height !== fh) {
        const c = document.createElement('canvas');
        c.width = fw; c.height = fh;
        _fbBlurRef.current = c;
      }
      const blurCtx = _fbBlurRef.current.getContext('2d');
      blurCtx.clearRect(0, 0, fw, fh);
      blurCtx.filter = 'blur(6px)';
      blurCtx.drawImage(layerCanvasRef.current, 0, 0);
      blurCtx.filter = 'none';
      layerCtx.clearRect(0, 0, fw, fh);
      layerCtx.drawImage(_fbBlurRef.current, 0, 0);

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

        if (!_fbMatteBlurRef.current || _fbMatteBlurRef.current.width !== fw || _fbMatteBlurRef.current.height !== fh) {
          const c = document.createElement('canvas');
          c.width = fw; c.height = fh;
          _fbMatteBlurRef.current = c;
        }
        const mBlurCtx = _fbMatteBlurRef.current.getContext('2d');
        mBlurCtx.clearRect(0, 0, fw, fh);
        mBlurCtx.filter = 'blur(4px)';
        mBlurCtx.drawImage(matteCanvasRef.current, 0, 0);
        mBlurCtx.filter = 'none';
        matteCtx.clearRect(0, 0, fw, fh);
        matteCtx.drawImage(_fbMatteBlurRef.current, 0, 0);
        punchOutEyesMouth(matteCtx, landmarks, fw, fh);

        ctx.save();
        ctx.globalCompositeOperation = 'multiply';
        ctx.drawImage(matteCanvasRef.current, 0, 0);
        ctx.restore();
      }
    }


    // ============================================================
    // LIP COLOR
    // ============================================================
    if (showLip && rgbLip) {
      ctx.save();
      fillPath(ctx, landmarks, LIPS_LOWER, fw, fh);
      ctx.clip('evenodd');
      ctx.globalCompositeOperation = 'multiply';
      ctx.fillStyle = `rgba(${rgbLip.r},${rgbLip.g},${rgbLip.b},0.7)`;
      ctx.fillRect(0, 0, fw, fh);
      ctx.restore();
      ctx.save();
      fillPath(ctx, landmarks, LIPS_UPPER, fw, fh);
      ctx.clip('evenodd');
      ctx.globalCompositeOperation = 'multiply';
      ctx.fillStyle = `rgba(${rgbLip.r},${rgbLip.g},${rgbLip.b},0.7)`;
      ctx.fillRect(0, 0, fw, fh);
      ctx.restore();
    }


    // ============================================================
    // LIP LINER — градієнтна смуга назовні від контуру губ
    // ============================================================
    if (showLipLiner && rgbLipLiner) {
      ctx.save();

      const linerBandWidth = Math.max(5, fw * 0.013);
      const softAlpha = 0.55;

      // ⬇️ ДОДАЄМО multiply — тепер олівець буде наноситися пігментно
      ctx.globalCompositeOperation = 'multiply';

      // ── Upper lip ──
      const upperPts = LIPS_UPPER_BORDER_OUTER;
      let upperBottomY = 0;
      let upperTopY = 1;
      for (const idx of upperPts) {
        const pt = landmarks[idx];
        if (pt) {
          if (pt.y > upperBottomY) upperBottomY = pt.y;
          if (pt.y < upperTopY) upperTopY = pt.y;
        }
      }

      ctx.beginPath();
      for (let i = 0; i < upperPts.length; i++) {
        const pt = landmarks[upperPts[i]];
        if (!pt) continue;
        if (i === 0) ctx.moveTo(pt.x * fw, pt.y * fh);
        else ctx.lineTo(pt.x * fw, pt.y * fh);
      }
      for (let i = upperPts.length - 1; i >= 0; i--) {
        const pt = landmarks[upperPts[i]];
        if (!pt) continue;
        ctx.lineTo(pt.x * fw, (pt.y * fh) - linerBandWidth);
      }
      ctx.closePath();

      const upperGrad = ctx.createLinearGradient(0, upperBottomY * fh, 0, (upperTopY * fh) - linerBandWidth);
      upperGrad.addColorStop(0, `rgba(${rgbLipLiner.r},${rgbLipLiner.g},${rgbLipLiner.b},0)`);
      upperGrad.addColorStop(0.25, `rgba(${rgbLipLiner.r},${rgbLipLiner.g},${rgbLipLiner.b},${softAlpha * 0.15})`);
      upperGrad.addColorStop(0.6, `rgba(${rgbLipLiner.r},${rgbLipLiner.g},${rgbLipLiner.b},${softAlpha * 0.5})`);
      upperGrad.addColorStop(1, `rgba(${rgbLipLiner.r},${rgbLipLiner.g},${rgbLipLiner.b},${softAlpha})`);
      ctx.fillStyle = upperGrad;
      ctx.fill();

      // ── Lower lip ──
      const lowerPts = LIPS_LOWER_BORDER_OUTER;
      let lowerTopY = 1;
      let lowerBottomY = 0;
      for (const idx of lowerPts) {
        const pt = landmarks[idx];
        if (pt) {
          if (pt.y < lowerTopY) lowerTopY = pt.y;
          if (pt.y > lowerBottomY) lowerBottomY = pt.y;
        }
      }

      ctx.beginPath();
      for (let i = 0; i < lowerPts.length; i++) {
        const pt = landmarks[lowerPts[i]];
        if (!pt) continue;
        if (i === 0) ctx.moveTo(pt.x * fw, pt.y * fh);
        else ctx.lineTo(pt.x * fw, pt.y * fh);
      }
      for (let i = lowerPts.length - 1; i >= 0; i--) {
        const pt = landmarks[lowerPts[i]];
        if (!pt) continue;
        ctx.lineTo(pt.x * fw, (pt.y * fh) + linerBandWidth);
      }
      ctx.closePath();

      const lowerGrad = ctx.createLinearGradient(0, lowerTopY * fh, 0, (lowerBottomY * fh) + linerBandWidth);
      lowerGrad.addColorStop(0, `rgba(${rgbLipLiner.r},${rgbLipLiner.g},${rgbLipLiner.b},0)`);
      lowerGrad.addColorStop(0.25, `rgba(${rgbLipLiner.r},${rgbLipLiner.g},${rgbLipLiner.b},${softAlpha * 0.15})`);
      lowerGrad.addColorStop(0.6, `rgba(${rgbLipLiner.r},${rgbLipLiner.g},${rgbLipLiner.b},${softAlpha * 0.5})`);
      lowerGrad.addColorStop(1, `rgba(${rgbLipLiner.r},${rgbLipLiner.g},${rgbLipLiner.b},${softAlpha})`);
      ctx.fillStyle = lowerGrad;
      ctx.fill();

      // ── Контурний штрих ──
      ctx.strokeStyle = `rgba(${rgbLipLiner.r},${rgbLipLiner.g},${rgbLipLiner.b},0.35)`;
      ctx.lineWidth = Math.max(1.5, fw * 0.003);
      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';
      strokePath(ctx, landmarks, LIPS_UPPER_BORDER_OUTER, fw, fh);
      ctx.stroke();
      strokePath(ctx, landmarks, LIPS_LOWER_BORDER_OUTER, fw, fh);
      ctx.stroke();

      ctx.restore(); // multiply зніметься разом із save/restore
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
        fillPath(ctx, landmarks, LIPS_LOWER, fw, fh);
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
        fillPath(ctx, landmarks, LIPS_UPPER, fw, fh);
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

  // ── Initialize isMobile from the host element's class ──
  // The .vto-mobile class is already applied by the Web Component's
  // connectedCallback() before React mounts, so we read it synchronously.
  // In standalone dev mode (no <virtual-try-on> element), fall back to
  // window.innerWidth for backward compatibility.
  const getInitialMobile = () => {
    try {
      const host = document.querySelector('virtual-try-on');
      if (host) return host.classList.contains('vto-mobile');
      // Dev mode fallback
      return window.innerWidth < 1024;
    } catch {
      return window.innerWidth < 1024;
    }
  };

  const [isMobile, setIsMobile] = useState(getInitialMobile);
  const [activeColorPicker, setActiveColorPicker] = useState(null);
  const [showDesktopSettings, setShowDesktopSettings] = useState(false);

  // ── Observe .vto-mobile class changes on the host <virtual-try-on> element ──
  // This replaces window.innerWidth-based detection with container-based
  // responsive layout (the class is managed by ResizeObserver in the Web Component).
  // In standalone dev mode, falls back to window resize detection.
  useEffect(() => {
    const host = document.querySelector('virtual-try-on');

    if (host) {
      // Plugin mode: observe class changes on the custom element
      const update = () => setIsMobile(host.classList.contains('vto-mobile'));
      update();

      const observer = new MutationObserver(update);
      observer.observe(host, { attributes: true, attributeFilter: ['class'] });
      return () => observer.disconnect();
    } else {
      // Dev mode fallback: use window resize
      const handleResize = () => setIsMobile(window.innerWidth < 1024);
      handleResize();
      window.addEventListener('resize', handleResize);
      return () => window.removeEventListener('resize', handleResize);
    }
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
        <p className="text-xs text-gray-400 mt-1">Whitens the eye area for a more radiant look</p>
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

  // ───── Foundation / Blush / Lipstick / Lipliner tones picker ─────
  const [showFoundationTones, setShowFoundationTones] = useState(false);
  const [showBlushTones, setShowBlushTones] = useState(false);
  const [showLipstickTones, setShowLipstickTones] = useState(false);
  const [showLiplinerTones, setShowLiplinerTones] = useState(false);

  // Використовуємо SKU з props (передані через атрибути <virtual-try-on>)
  const toneZones = foundationProductSku ? computeToneZones(foundationTones, foundationProductSku) : null;
  const blushZones = blushProductSku ? computeToneZones(blushTones, blushProductSku) : null;
  const lipstickZones = lipstickProductSku ? computeToneZones(lipstickTones, lipstickProductSku) : null;
  const liplinerZones = liplinerProductSku ? computeToneZones(liplinerTones, liplinerProductSku) : null;

  const renderToneZoneGrid = (tones, zoneClass) => (
    <div className={`foundation-tones-grid ${zoneClass}`}>
      {tones.map(tone => (
        <button
          key={tone.sku}
          className={`foundation-tone-btn ${foundationColor === tone.hex ? 'selected' : ''}`}
          onClick={() => {
            setFoundationColor(tone.hex);
            setShowFoundation(true);
            setShowFoundationTones(false);
          }}
        >
          <span className="foundation-tone-circle" style={{ backgroundColor: tone.hex }} />
          <span className="foundation-tone-number">{tone.number}</span>
        </button>
      ))}
    </div>
  );

  const foundationTonesPanel = (
    <div className="foundation-tones-overlay" onClick={() => setShowFoundationTones(false)}>
      <div className="foundation-tones-sheet" onClick={(e) => e.stopPropagation()}>
        <div className="foundation-tones-header">
          <h3>Foundation Tones</h3>
          <div className="foundation-tones-actions">
            <button className={`foundation-tones-disable ${showFoundation ? '' : 'active'}`} title="Disable layer" onClick={() => { setFoundationColor(''); setShowFoundation(false); setShowFoundationTones(false); }}>
              <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5">
                <circle cx="10" cy="10" r="8" />
                <line x1="5" y1="5" x2="15" y2="15" />
              </svg>
            </button>
            <button className="foundation-tones-close" onClick={() => setShowFoundationTones(false)}>✕</button>
          </div>
        </div>
        {toneZones ? (
          <div className="foundation-tones-zones">
            {/* Safe zone */}
            <div className="zone-group zone-safe">
              <div className="zone-label zone-label-safe">✅ Safe zone</div>
              <div className="zone-desc zone-desc-safe">The perfect match</div>
              {renderToneZoneGrid(toneZones.safeZone, 'zone-grid-safe')}
            </div>
            {/* Green zone */}
            <div className="zone-group zone-green">
              <div className="zone-label zone-label-green">🟢 Green zone</div>
              <div className="zone-desc zone-desc-green">High probability of a good match</div>
              {renderToneZoneGrid(toneZones.greenZone, 'zone-grid-green')}
            </div>
            {/* Unpredictable zone */}
            <div className="zone-group zone-unpredictable">
              <div className="zone-label zone-label-unpredictable">🟡 Unpredictable zone</div>
              <div className="zone-desc zone-desc-unpredictable">Tones with unpredictable results</div>
              {renderToneZoneGrid(toneZones.unpredictableZone, 'zone-grid-unpredictable')}
            </div>
          </div>
        ) : (
          <div className="foundation-tones-grid">
            {foundationTones.map(tone => (
              <button
                key={tone.sku}
                className={`foundation-tone-btn ${foundationColor === tone.hex ? 'selected' : ''}`}
                onClick={() => {
                  setFoundationColor(tone.hex);
                  setShowFoundation(true);
                  setShowFoundationTones(false);
                }}
              >
                <span className="foundation-tone-circle" style={{ backgroundColor: tone.hex }} />
                <span className="foundation-tone-number">{tone.number}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );

  const renderBlushZoneGrid = (tones, zoneClass) => (
    <div className={`foundation-tones-grid ${zoneClass}`}>
      {tones.map(tone => (
        <button
          key={tone.sku}
          className={`foundation-tone-btn ${blushColor === tone.hex ? 'selected' : ''}`}
          onClick={() => {
            setBlushColor(tone.hex);
            setShowBlush(true);
            setShowBlushTones(false);
          }}
        >
          <span className="foundation-tone-circle" style={{ backgroundColor: tone.hex }} />
          <span className="foundation-tone-number">{tone.name}</span>
        </button>
      ))}
    </div>
  );

  // ───── Blush tones picker ─────
  const blushTonesPanel = (
    <div className="foundation-tones-overlay" onClick={() => setShowBlushTones(false)}>
      <div className="foundation-tones-sheet" onClick={(e) => e.stopPropagation()}>
        <div className="foundation-tones-header">
          <h3>Blush Tones</h3>
          <div className="foundation-tones-actions">
            <button className={`foundation-tones-disable ${showBlush ? '' : 'active'}`} title="Disable layer" onClick={() => { setBlushColor(''); setShowBlush(false); setShowBlushTones(false); }}>
              <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5">
                <circle cx="10" cy="10" r="8" />
                <line x1="5" y1="5" x2="15" y2="15" />
              </svg>
            </button>
            <button className="foundation-tones-close" onClick={() => setShowBlushTones(false)}>✕</button>
          </div>
        </div>
        {blushZones ? (
          <div className="foundation-tones-zones">
            {/* Safe zone */}
            <div className="zone-group zone-safe">
              <div className="zone-label zone-label-safe">✅ Safe zone</div>
              <div className="zone-desc zone-desc-safe">The perfect match</div>
              {renderBlushZoneGrid(blushZones.safeZone, 'zone-grid-safe')}
            </div>
            {/* Green zone */}
            <div className="zone-group zone-green">
              <div className="zone-label zone-label-green">🟢 Green zone</div>
              <div className="zone-desc zone-desc-green">High probability of a good match</div>
              {renderBlushZoneGrid(blushZones.greenZone, 'zone-grid-green')}
            </div>
            {/* Unpredictable zone */}
            <div className="zone-group zone-unpredictable">
              <div className="zone-label zone-label-unpredictable">🟡 Unpredictable zone</div>
              <div className="zone-desc zone-desc-unpredictable">Tones with unpredictable results</div>
              {renderBlushZoneGrid(blushZones.unpredictableZone, 'zone-grid-unpredictable')}
            </div>
          </div>
        ) : (
          <div className="foundation-tones-grid">
            {blushTones.map(tone => (
              <button
                key={tone.sku}
                className={`foundation-tone-btn ${blushColor === tone.hex ? 'selected' : ''}`}
                onClick={() => {
                  setBlushColor(tone.hex);
                  setShowBlush(true);
                  setShowBlushTones(false);
                }}
              >
                <span className="foundation-tone-circle" style={{ backgroundColor: tone.hex }} />
                <span className="foundation-tone-number">{tone.name}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );

  const renderLipstickZoneGrid = (tones, zoneClass) => (
    <div className={`foundation-tones-grid ${zoneClass}`}>
      {tones.map(tone => (
        <button
          key={tone.sku}
          className={`foundation-tone-btn ${lipColor === tone.hex ? 'selected' : ''}`}
          onClick={() => {
            setLipColor(tone.hex);
            setShowLip(true);
            setShowLipstickTones(false);
          }}
        >
          <span className="foundation-tone-circle" style={{ backgroundColor: tone.hex }} />
          <span className="foundation-tone-number">{tone.name}</span>
        </button>
      ))}
    </div>
  );

  // ───── Lipstick tones picker ─────
  const lipstickTonesPanel = (
    <div className="foundation-tones-overlay" onClick={() => setShowLipstickTones(false)}>
      <div className="foundation-tones-sheet" onClick={(e) => e.stopPropagation()}>
        <div className="foundation-tones-header">
          <h3>Lipstick Tones</h3>
          <div className="foundation-tones-actions">
            <button className={`foundation-tones-disable ${showLip ? '' : 'active'}`} title="Disable layer" onClick={() => { setLipColor(''); setShowLip(false); setShowLipstickTones(false); }}>
              <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5">
                <circle cx="10" cy="10" r="8" />
                <line x1="5" y1="5" x2="15" y2="15" />
              </svg>
            </button>
            <button className="foundation-tones-close" onClick={() => setShowLipstickTones(false)}>✕</button>
          </div>
        </div>
        {lipstickZones ? (
          <div className="foundation-tones-zones">
            {/* Safe zone */}
            <div className="zone-group zone-safe">
              <div className="zone-label zone-label-safe">✅ Safe zone</div>
              <div className="zone-desc zone-desc-safe">The perfect match</div>
              {renderLipstickZoneGrid(lipstickZones.safeZone, 'zone-grid-safe')}
            </div>
            {/* Green zone */}
            <div className="zone-group zone-green">
              <div className="zone-label zone-label-green">🟢 Green zone</div>
              <div className="zone-desc zone-desc-green">High probability of a good match</div>
              {renderLipstickZoneGrid(lipstickZones.greenZone, 'zone-grid-green')}
            </div>
            {/* Unpredictable zone */}
            <div className="zone-group zone-unpredictable">
              <div className="zone-label zone-label-unpredictable">🟡 Unpredictable zone</div>
              <div className="zone-desc zone-desc-unpredictable">Tones with unpredictable results</div>
              {renderLipstickZoneGrid(lipstickZones.unpredictableZone, 'zone-grid-unpredictable')}
            </div>
          </div>
        ) : (
          <div className="foundation-tones-grid">
            {lipstickTones.map(tone => (
              <button
                key={tone.sku}
                className={`foundation-tone-btn ${lipColor === tone.hex ? 'selected' : ''}`}
                onClick={() => {
                  setLipColor(tone.hex);
                  setShowLip(true);
                  setShowLipstickTones(false);
                }}
              >
                <span className="foundation-tone-circle" style={{ backgroundColor: tone.hex }} />
                <span className="foundation-tone-number">{tone.name}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );

  const renderLiplinerZoneGrid = (tones, zoneClass) => (
    <div className={`foundation-tones-grid ${zoneClass}`}>
      {tones.map(tone => (
        <button
          key={tone.sku}
          className={`foundation-tone-btn ${lipLinerColor === tone.hex ? 'selected' : ''}`}
          onClick={() => {
            setLipLinerColor(tone.hex);
            setShowLipLiner(true);
            setShowLiplinerTones(false);
          }}
        >
          <span className="foundation-tone-circle" style={{ backgroundColor: tone.hex }} />
          <span className="foundation-tone-number">{tone.name}</span>
        </button>
      ))}
    </div>
  );

  // ───── Lipliner tones picker ─────
  const liplinerTonesPanel = (
    <div className="foundation-tones-overlay" onClick={() => setShowLiplinerTones(false)}>
      <div className="foundation-tones-sheet" onClick={(e) => e.stopPropagation()}>
        <div className="foundation-tones-header">
          <h3>Lipliner Tones</h3>
          <div className="foundation-tones-actions">
            <button className={`foundation-tones-disable ${showLipLiner ? '' : 'active'}`} title="Disable layer" onClick={() => { setLipLinerColor(''); setShowLipLiner(false); setShowLiplinerTones(false); }}>
              <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5">
                <circle cx="10" cy="10" r="8" />
                <line x1="5" y1="5" x2="15" y2="15" />
              </svg>
            </button>
            <button className="foundation-tones-close" onClick={() => setShowLiplinerTones(false)}>✕</button>
          </div>
        </div>
        {liplinerZones ? (
          <div className="foundation-tones-zones">
            {/* Safe zone */}
            <div className="zone-group zone-safe">
              <div className="zone-label zone-label-safe">✅ Safe zone</div>
              <div className="zone-desc zone-desc-safe">The perfect match</div>
              {renderLiplinerZoneGrid(liplinerZones.safeZone, 'zone-grid-safe')}
            </div>
            {/* Green zone */}
            <div className="zone-group zone-green">
              <div className="zone-label zone-label-green">🟢 Green zone</div>
              <div className="zone-desc zone-desc-green">High probability of a good match</div>
              {renderLiplinerZoneGrid(liplinerZones.greenZone, 'zone-grid-green')}
            </div>
            {/* Unpredictable zone */}
            <div className="zone-group zone-unpredictable">
              <div className="zone-label zone-label-unpredictable">🟡 Unpredictable zone</div>
              <div className="zone-desc zone-desc-unpredictable">Tones with unpredictable results</div>
              {renderLiplinerZoneGrid(liplinerZones.unpredictableZone, 'zone-grid-unpredictable')}
            </div>
          </div>
        ) : (
          <div className="foundation-tones-grid">
            {liplinerTones.map(tone => (
              <button
                key={tone.sku}
                className={`foundation-tone-btn ${lipLinerColor === tone.hex ? 'selected' : ''}`}
                onClick={() => {
                  setLipLinerColor(tone.hex);
                  setShowLipLiner(true);
                  setShowLiplinerTones(false);
                }}
              >
                <span className="foundation-tone-circle" style={{ backgroundColor: tone.hex }} />
                <span className="foundation-tone-number">{tone.name}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );

  const pickerMeta = {
    foundation: { title: 'Foundation', currentColor: foundationColor, setColor: setFoundationColor, swatches: ['#f3cfb3', '#e4b38d', '#d3a17e', '#c68e65', '#8d5524', '#5c381a', '#3e2211', '#f5e0cc'], show: showFoundation, toggle: () => setShowFoundation(v => !v), setShow: setShowFoundation },
    blush: { title: 'Blush', currentColor: blushColor, setColor: setBlushColor, swatches: ['#FF9999', '#FFCCCC', '#F08080', '#CD5C5C', '#E9967A', '#FFA07A', '#FFB6C1', '#FF69B4'], show: showBlush, toggle: () => setShowBlush(v => !v), setShow: setShowBlush },
    lip: { title: 'Lipstick', currentColor: lipColor, setColor: setLipColor, swatches: ['#CC3333', '#FF6699', '#EE82EE', '#A0522D', '#8B0000', '#FFD700', '#DC143C', '#C71585'], show: showLip, toggle: () => setShowLip(v => !v), setShow: setShowLip },
    gloss: { title: 'Lip Gloss', currentColor: lipGlossColor, setColor: setLipGlossColor, swatches: ['#FFD6E8', '#FFD700', '#FFE4B5', '#F5DEB3', '#E0F0FF', '#FFC0CB', '#DDA0DD', '#FFF0F5'], show: showGloss, toggle: () => setShowGloss(v => !v), setShow: setShowGloss },
    lipLiner: { title: 'Lip Liner', currentColor: lipLinerColor, setColor: setLipLinerColor, swatches: ['#8B0000', '#A0522D', '#CD5C5C', '#800020', '#483C32', '#660000', '#4A0404', '#2C1608'], show: showLipLiner, toggle: () => setShowLipLiner(v => !v), setShow: setShowLipLiner },
  };

  const activePicker = activeColorPicker ? pickerMeta[activeColorPicker] : null;

  const colorPickerOverlay = activePicker && (
    <div className="color-picker-overlay" onClick={() => setActiveColorPicker(null)}>
      <div className="color-picker-sheet" onClick={(e) => e.stopPropagation()}>
        <div className="color-picker-header">
          <h3>{activePicker.title}</h3>
          <div className="foundation-tones-actions">
            <button className={`foundation-tones-disable ${activePicker.show ? '' : 'active'}`} title="Disable layer" onClick={() => { activePicker.setColor(''); activePicker.setShow(false); setActiveColorPicker(null); }}>
              <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5">
                <circle cx="10" cy="10" r="8" />
                <line x1="5" y1="5" x2="15" y2="15" />
              </svg>
            </button>
            <button className="color-picker-close" onClick={() => setActiveColorPicker(null)}>✕</button>
          </div>
        </div>
        <div className="color-grid">
          {activePicker.swatches.map(color => (
            <button key={color} className={`color-swatch ${activePicker.currentColor === color ? 'selected' : ''}`} style={{ backgroundColor: color }} onClick={() => { activePicker.setColor(color); activePicker.setShow(true); setActiveColorPicker(null); }} />
          ))}
        </div>
        <div className="custom-color-row">
          <label>Custom color</label>
          <input type="color" value={activePicker.currentColor} onChange={(e) => { activePicker.setColor(e.target.value); activePicker.setShow(true); setActiveColorPicker(null); }} />
        </div>
        <div className="bottom-actions">
          <button className="btn-compare" onClick={() => { activePicker.toggle(); setActiveColorPicker(null); }}>{activePicker.show ? 'Hide layer' : 'Show layer'}</button>
          <button className="btn-screenshot" onClick={() => { takeScreenshot(); setActiveColorPicker(null); }}>Screenshot</button>
        </div>
      </div>
    </div>
  );

  // ════════════════════════════════════════════════════════════════
  // СТАБІЛЬНИЙ КОНТЕЙНЕР для <video> та <canvas>
  // Рендериться завжди, ніколи не демонтується при зміні layout,
  // тому MediaPipe Camera не втрачає посилання на video елемент.
  // ════════════════════════════════════════════════════════════════
  const persistentVideoContainer = (
    <div className={`app-video-persistent${showSideLighting && !isMobile ? ' has-lighting' : ''}`}>
      <video ref={videoRef} style={{ display: 'none' }} autoPlay muted playsInline />
      <canvas ref={canvasRef} width="640" height="480" />
    </div>
  );

  // ───── Desktop color picker popup ─────
  const desktopColorPicker = activePicker && (
    <div className="desktop-color-picker-overlay" onClick={() => setActiveColorPicker(null)}>
      <div className="desktop-color-picker-panel" onClick={(e) => e.stopPropagation()}>
        <div className="desktop-color-picker-header">
          <h3>{activePicker.title}</h3>
          <div className="picker-actions">
            <button className={`foundation-tones-disable ${activePicker.show ? '' : 'active'}`} title="Disable layer" onClick={() => { activePicker.setColor(''); activePicker.setShow(false); setActiveColorPicker(null); }}>
              <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5">
                <circle cx="10" cy="10" r="8" />
                <line x1="5" y1="5" x2="15" y2="15" />
              </svg>
            </button>
            <button className="color-picker-close" onClick={() => setActiveColorPicker(null)}>✕</button>
          </div>
        </div>
        <div className="desktop-color-swatches">
          {activePicker.swatches.map(color => (
            <button key={color} className={`desktop-color-swatch ${activePicker.currentColor === color ? 'selected' : ''}`} style={{ backgroundColor: color }} onClick={() => { activePicker.setColor(color); activePicker.setShow(true); setActiveColorPicker(null); }} />
          ))}
        </div>
        <div className="desktop-custom-color-row">
          <label>Custom color</label>
          <input type="color" value={activePicker.currentColor} onChange={(e) => { activePicker.setColor(e.target.value); activePicker.setShow(true); setActiveColorPicker(null); }} />
        </div>
        <div className="desktop-picker-actions">
          <button className={`toggle-layer-btn ${activePicker.show ? '' : 'hidden'}`} onClick={() => { activePicker.toggle(); setActiveColorPicker(null); }}>{activePicker.show ? 'Hide layer' : 'Show layer'}</button>
          <button className="picker-screenshot-btn" onClick={() => { takeScreenshot(); setActiveColorPicker(null); }}>Screenshot</button>
        </div>
      </div>
    </div>
  );

  // ───── Desktop settings panel (5th dock item) ─────
  const desktopSettingsPanel = showDesktopSettings && (
    <div className="desktop-settings-overlay" onClick={() => setShowDesktopSettings(false)}>
      <div className="desktop-settings-panel" onClick={(e) => e.stopPropagation()}>
        <div className="desktop-settings-header">
          <h3>⚙️ Settings</h3>
          <button className="desktop-settings-close" onClick={() => setShowDesktopSettings(false)}>✕</button>
        </div>

        <div className="desktop-settings-group">
          <label>
            <input type="checkbox" checked={showGloss} onChange={(e) => setShowGloss(e.target.checked)} />
            Lip Gloss
          </label>
          {showGloss && (
            <div className="slider-row">
              <span style={{fontSize:'12px', color:'rgba(255,255,255,0.5)', flexShrink:0}}>Intensity</span>
              <input type="range" min="0" max="1" step="0.01" value={lipGlossOpacity} onChange={(e) => setLipGlossOpacity(parseFloat(e.target.value))} />
              <span className="slider-value">{Math.round(lipGlossOpacity * 100)}%</span>
            </div>
          )}
        </div>

        <div className="desktop-settings-group">
          <label>
            <input type="checkbox" checked={skinSmooth} onChange={(e) => setSkinSmooth(e.target.checked)} />
            Skin Smoothing
          </label>
          {skinSmooth && (
            <div className="slider-row">
              <span style={{fontSize:'12px', color:'rgba(255,255,255,0.5)', flexShrink:0}}>Strength</span>
              <input type="range" min="0" max="0.7" step="0.01" value={skinSmoothStrength} onChange={(e) => setSkinSmoothStrength(parseFloat(e.target.value))} />
              <span className="slider-value">{Math.round(skinSmoothStrength * 100)}%</span>
            </div>
          )}
        </div>

        <div className="desktop-settings-group">
          <label>Foundation Coverage: {Math.round(opacity * 100)}%</label>
          <div className="slider-row">
            <input type="range" min="0" max="0.5" step="0.01" value={opacity} onChange={(e) => setOpacity(parseFloat(e.target.value))} />
            <span className="slider-value">{Math.round(opacity * 100)}%</span>
          </div>
        </div>

        <div className="desktop-settings-group">
          <label>Matte Finish: {Math.round(matte * 100)}%</label>
          <div className="slider-row">
            <input type="range" min="0" max="1" step="0.01" value={matte} onChange={(e) => setMatte(parseFloat(e.target.value))} />
            <span className="slider-value">{Math.round(matte * 100)}%</span>
          </div>
        </div>

        <div className="desktop-settings-group">
          <label>Eye Brightness: {Math.round(eyeBrightness * 100)}%</label>
          <div className="slider-row">
            <input type="range" min="0" max="0.1" step="0.01" value={eyeBrightness} onChange={(e) => setEyeBrightness(parseFloat(e.target.value))} />
            <span className="slider-value">{Math.round(eyeBrightness * 100)}%</span>
          </div>
        </div>

        <div className="desktop-settings-actions">
          <button className="desktop-btn-screenshot" onClick={() => { takeScreenshot(); setShowDesktopSettings(false); }}>
            📸 Screenshot
          </button>
        </div>
      </div>
    </div>
  );

  return (
    <>
      {/* ═══ СТАБІЛЬНЕ ВІДЕО/КАНВАС — завжди змонтовано ═══ */}
      {persistentVideoContainer}

      {isMobile ? (
        /* ═══ МОБІЛЬНИЙ LAYOUT ═══ */
        <div className={`mobile-layout${isSingleProductView ? ' mobile-layout-single-product' : ''}`}>
          <div className="video-area" />

          {!isSingleProductView && (
            <>
              {/* ✨ Auto Match Foundation (mobile circular button) */}
              <button
                className={`mobile-auto-match-btn${lowLightWarning ? ' disabled' : ''}`}
                onClick={handleAutoMatchClick}
                disabled={autoMatching || lowLightWarning}
                aria-label="Auto match foundation"
              >
                {autoMatching ? (
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ width: 22, height: 22, color: '#c084fc' }}>
                    <circle cx="12" cy="12" r="10" strokeDasharray="31.4 31.4" strokeDashoffset="10">
                      <animateTransform attributeName="transform" type="rotate" from="0 12 12" to="360 12 12" dur="1s" repeatCount="indefinite" />
                    </circle>
                  </svg>
                ) : (
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ width: 22, height: 22, color: 'rgba(255,255,255,0.85)' }}>
                    <path d="M14 4L12 2M18 8L20 6M16 12L18 14M6 18L4 20M9 5L5 9M5 5L9 9" />
                    <path d="M13 3L21 11" />
                    <circle cx="6" cy="18" r="1.5" fill="currentColor" />
                    <circle cx="18" cy="6" r="1.5" fill="currentColor" />
                    <circle cx="12" cy="12" r="1" fill="currentColor" />
                  </svg>
                )}
              </button>

              {lowLightWarning && (
                <div className="shadow-warning shadow-warning-overlay"><span>⚠</span> Poor lighting — add more light for accurate shade matching</div>
              )}
              <div className="controls-panel">

                <div className="color-buttons">
                  <div className="color-btn-wrapper">
                    <button className={`color-btn color-btn-foundation ${activeColorPicker === 'foundation' || showFoundationTones ? 'active' : ''}`} style={{ border: `5px solid ${foundationColor}` }} onClick={() => setShowFoundationTones(true)} />
                    <span className="color-btn-label">Foundation</span>
                  </div>
                  <div className="color-btn-wrapper">
                    <button className={`color-btn color-btn-blush ${showBlushTones ? 'active' : ''}`} style={{ border: `5px solid ${blushColor}` }} onClick={() => setShowBlushTones(true)} />
                    <span className="color-btn-label">Blush</span>
                  </div>
                  <div className="color-btn-wrapper">
                    <button className={`color-btn color-btn-lip ${showLipstickTones ? 'active' : ''}`} style={{ border: `5px solid ${lipColor}` }} onClick={() => setShowLipstickTones(true)} />
                    <span className="color-btn-label">Lipstick</span>
                  </div>
                  <div className="color-btn-wrapper">
                    <button className={`color-btn color-btn-liner ${showLiplinerTones ? 'active' : ''}`} style={{ border: `5px solid ${lipLinerColor}` }} onClick={() => setShowLiplinerTones(true)} />
                    <span className="color-btn-label">Liner</span>
                  </div>
                </div>
              </div>
            </>
          )}
          {activeColorPicker && activeColorPicker !== 'foundation' && colorPickerOverlay}
          {showFoundationTones && foundationTonesPanel}
          {showBlushTones && blushTonesPanel}
          {showLipstickTones && lipstickTonesPanel}
          {showLiplinerTones && liplinerTonesPanel}

          {/* ✨ Auto-match notification (mobile) */}
          {showAutoMatch && (
            <div className="auto-match-notification" onClick={() => setShowAutoMatch(false)}>
              <div className="auto-match-content">
                <div className="auto-match-icon">✨</div>
                {autoMatchResult ? (
                  <>
                    <div className="auto-match-title">Foundation Auto-Matched!</div>
                    <div className="auto-match-detail">
                      <span className="auto-match-swatch" style={{ backgroundColor: autoMatchResult.hex }} />
                      <span>Tone #{autoMatchResult.number}</span>
                    </div>
                  </>
                ) : (
                  <div className="auto-match-title">Could not match — not enough skin samples</div>
                )}
              </div>
            </div>
          )}
        </div>

      ) : (
        /* ═══ ДЕСКТОПНИЙ LAYOUT ═══ */
        <div className={`desktop-layout${isSingleProductView ? ' desktop-layout-single-product' : ''}`}>
          <div className="desktop-layout-inner">
            {showSideLighting && <div className="desktop-lighting-frame" />}
            <div className={`desktop-video-area ${showSideLighting ? 'has-lighting' : ''}`} />
          </div>

          {!isSingleProductView && (
            <>
              {/* Shadow warning */}
              {lowLightWarning && (
                <div className="desktop-shadow-warning">
                  <span>⚠️</span> Poor lighting — add more light for accurate shade matching
                </div>
              )}

              {/* ===== macOS-style Dock ===== */}
              <div className="desktop-dock">
                {/* 1. Foundation */}
                <div className="dock-item" onClick={() => setShowFoundationTones(true)}>
                  <div className="dock-icon dock-icon-foundation" style={{ border: `3px solid ${foundationColor}` }} />
                  <div className={`dock-icon-indicator ${showFoundation ? 'active-indicator' : ''}`} style={{ backgroundColor: showFoundation ? foundationColor : 'rgba(255,255,255,0.2)' }} />
                  <span className="dock-label">Foundation</span>
                </div>

                {/* 2. Blush */}
                <div className="dock-item" onClick={() => setShowBlushTones(true)}>
                  <div className="dock-icon dock-icon-blush" style={{ border: `3px solid ${blushColor}` }} />
                  <div className={`dock-icon-indicator ${showBlush ? 'active-indicator' : ''}`} style={{ backgroundColor: showBlush ? blushColor : 'rgba(255,255,255,0.2)' }} />
                  <span className="dock-label">Blush</span>
                </div>

                {/* 3. Lipstick */}
                <div className="dock-item" onClick={() => setShowLipstickTones(true)}>
                  <div className="dock-icon dock-icon-lip" style={{ border: `3px solid ${lipColor}` }} />
                  <div className={`dock-icon-indicator ${showLip ? 'active-indicator' : ''}`} style={{ backgroundColor: showLip ? lipColor : 'rgba(255,255,255,0.2)' }} />
                  <span className="dock-label">Lipstick</span>
                </div>

                {/* 4. Lip Liner */}
                <div className="dock-item" onClick={() => setShowLiplinerTones(true)}>
                  <div className="dock-icon dock-icon-liner" style={{ border: `3px solid ${lipLinerColor}` }} />
                  <div className={`dock-icon-indicator ${showLipLiner ? 'active-indicator' : ''}`} style={{ backgroundColor: showLipLiner ? lipLinerColor : 'rgba(255,255,255,0.2)' }} />
                  <span className="dock-label">Liner</span>
                </div>

                {/* Separator */}
                <div className="dock-separator" />

                {/* 5. ✨ Auto Match Foundation */}
                <div className={`dock-item${lowLightWarning ? ' dock-item-disabled' : ''}`} onClick={lowLightWarning ? undefined : handleAutoMatchClick} style={{ cursor: lowLightWarning ? 'not-allowed' : 'pointer' }}>
                  <div className="dock-icon" style={{ background: autoMatching ? 'rgba(168,85,247,0.3)' : lowLightWarning ? 'rgba(168,85,247,0.06)' : 'rgba(168,85,247,0.12)', border: autoMatching ? '2px solid rgba(168,85,247,0.6)' : lowLightWarning ? '1px solid rgba(168,85,247,0.1)' : '1px solid rgba(168,85,247,0.25)' }}>
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ width: 26, height: 26, color: autoMatching ? '#c084fc' : lowLightWarning ? 'rgba(255,255,255,0.3)' : 'rgba(255,255,255,0.7)' }}>
                      <path d="M14 4L12 2M18 8L20 6M16 12L18 14M6 18L4 20M9 5L5 9M5 5L9 9" />
                      <path d="M13 3L21 11" />
                      <circle cx="6" cy="18" r="1.5" fill="currentColor" />
                      <circle cx="18" cy="6" r="1.5" fill="currentColor" />
                      <circle cx="12" cy="12" r="1" fill="currentColor" />
                    </svg>

                  </div>
                  <div className={`dock-icon-indicator ${showFoundation ? 'active-indicator' : ''}`} style={{ backgroundColor: showFoundation ? foundationColor : 'rgba(255,255,255,0.2)' }} />
                  <span className="dock-label">Auto Match</span>
                </div>

                {/* 6. Side Lighting */}
                <div className="dock-item" onClick={() => setShowSideLighting(v => !v)}>

                  <div className="dock-icon" style={{ background: showSideLighting ? 'rgba(255,255,255,0.25)' : 'rgba(255,255,255,0.1)', border: '1px solid rgba(255,255,255,0.2)' }}>
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ width: 26, height: 26, color: showSideLighting ? '#fff' : 'rgba(255,255,255,0.7)' }}>
                      <circle cx="12" cy="12" r="5" />
                      <path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42" />
                    </svg>
                  </div>
                  <div className={`dock-icon-indicator ${showSideLighting ? 'active-indicator' : ''}`} style={{ backgroundColor: showSideLighting ? 'rgba(255,255,255,0.9)' : 'rgba(255,255,255,0.2)' }} />
                  <span className="dock-label">Lighting</span>
                </div>

                {/* 7. Settings (gear) — all extra controls */}

                <div className="dock-item" onClick={() => setShowDesktopSettings(true)}>
                  <div className="dock-icon dock-icon-settings">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                      <circle cx="12" cy="12" r="3" />
                      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
                    </svg>
                  </div>
                  <div className={`dock-icon-indicator ${showDesktopSettings ? 'active-indicator' : ''}`} style={{ backgroundColor: showDesktopSettings ? 'rgba(255,255,255,0.7)' : 'rgba(255,255,255,0.2)' }} />
                  <span className="dock-label">Settings</span>
                </div>
              </div>

              {/* Foundation tones picker overlay */}
              {showFoundationTones && foundationTonesPanel}
              {showBlushTones && blushTonesPanel}
              {showLipstickTones && lipstickTonesPanel}
              {showLiplinerTones && liplinerTonesPanel}

              {/* Desktop color picker popup */}
              {activeColorPicker && activeColorPicker !== 'foundation' && desktopColorPicker}

              {/* Desktop settings panel */}
              {desktopSettingsPanel}

              {/* ✨ Auto-match notification */}
              {showAutoMatch && (
                <div className="auto-match-notification" onClick={() => setShowAutoMatch(false)}>
                  <div className="auto-match-content">
                    <div className="auto-match-icon">✨</div>
                    {autoMatchResult ? (
                      <>
                        <div className="auto-match-title">Foundation Auto-Matched!</div>
                        <div className="auto-match-detail">
                          <span className="auto-match-swatch" style={{ backgroundColor: autoMatchResult.hex }} />
                          <span>Tone #{autoMatchResult.number}</span>
                        </div>
                      </>
                    ) : (
                      <div className="auto-match-title">Could not match — not enough skin samples</div>
                    )}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* ═══ Auto-match instruction popup ═══ */}
      {showAutoMatchPopup && (
        <div className="auto-match-popup-overlay" onClick={cancelAutoMatch}>
          <div className="auto-match-popup-panel" onClick={(e) => e.stopPropagation()}>
            <div className="auto-match-popup-header">
              <h3>💡 Before Auto-Match</h3>
              <button className="auto-match-popup-close" onClick={cancelAutoMatch}>✕</button>
            </div>
            <div className="auto-match-popup-body">
              <p>For the best foundation shade match, please follow these tips:</p>
              <ul>
                <li>Make sure you are in a <strong>well-lit room</strong> with natural or bright light.</li>
                <li>Avoid <strong>harsh shadows</strong> on your face — neither side should be in shadow.</li>
                <li>Keep your <strong>head facing straight</strong> toward the camera.</li>
                <li>Ensure both the <strong>left and right sides of your face</strong> are evenly lit.</li>
              </ul>
              <div className="auto-match-popup-disclaimer">
                <strong>Please note:</strong> Due to differences in camera sensors, lighting conditions, and individual skin tones, the matched shade is a <strong>recommendation only</strong>. We encourage you to review the result and decide whether you like the suggested tone before confirming it.
              </div>
            </div>
            <div className="auto-match-popup-actions">
              <button className="auto-match-popup-cancel" onClick={cancelAutoMatch}>Cancel</button>
              <button className="auto-match-popup-confirm" onClick={confirmAutoMatch}>Let's Match ✨</button>
            </div>
          </div>
        </div>
      )}
    </>

  );
}

export default App;
