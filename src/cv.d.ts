/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable no-var */

/** Minimal type declarations for OpenCV.js (global `cv`) */

interface CVMat {
  rows: number;
  cols: number;
  data: Uint8ClampedArray;
  dataPtr: number;
  delete(): void;
  clone(): CVMat;
  roi(rect: CVRect): CVMat;
  copyTo(dst: CVMat): void;
}

interface CVRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface CVSize {
  width: number;
  height: number;
}

interface CVMatVector {
  size(): number;
  get(i: number): CVMat;
  delete(): void;
}

/** The global `cv` object from OpenCV.js */
interface CV {
  Mat: new () => CVMat;
  MatVector: new () => CVMatVector;
  Size: new (width: number, height: number) => CVSize;
  Rect: new (x: number, y: number, w: number, h: number) => CVRect;

  matFromImageData(imageData: ImageData): CVMat;

  cvtColor(src: CVMat, dst: CVMat, code: number): void;
  split(src: CVMat, mv: CVMatVector): void;
  threshold(
    src: CVMat,
    dst: CVMat,
    thresh: number,
    maxval: number,
    type: number,
  ): void;
  bitwise_and(src1: CVMat, src2: CVMat, dst: CVMat): void;
  bitwise_or(src1: CVMat, src2: CVMat, dst: CVMat): void;
  bitwise_not(src: CVMat, dst: CVMat): void;
  morphologyEx(
    src: CVMat,
    dst: CVMat,
    op: number,
    kernel: CVMat,
  ): void;
  getStructuringElement(shape: number, ksize: CVSize): CVMat;
  findContours(
    image: CVMat,
    contours: CVMatVector,
    hierarchy: CVMat,
    mode: number,
    method: number,
  ): void;
  contourArea(contour: CVMat): number;
  boundingRect(contour: CVMat): CVRect;
  GaussianBlur(
    src: CVMat,
    dst: CVMat,
    ksize: CVSize,
    sigmaX: number,
  ): void;

  // Constants
  COLOR_RGBA2RGB: number;
  COLOR_RGB2HSV: number;
  COLOR_RGBA2Lab: number;
  THRESH_BINARY: number;
  THRESH_BINARY_INV: number;
  MORPH_OPEN: number;
  MORPH_CLOSE: number;
  MORPH_ELLIPSE: number;
  RETR_EXTERNAL: number;
  CHAIN_APPROX_SIMPLE: number;
}

/** Make `cv` available globally */
declare var cv: CV;

/** Event fired when OpenCV.js has finished loading */
interface WindowEventMap {
  cvReady: CustomEvent;
}
