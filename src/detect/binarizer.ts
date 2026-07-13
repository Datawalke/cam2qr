import { BitImage } from './bit-image.js';
import type { GrayImage } from './grayscale.js';

/**
 * Adaptive thresholding built on an integral image (summed-area table): every
 * pixel is compared against the mean luminance of a sliding square window
 * around it, sized from the frame dimensions. A pixel is dark when it sits
 * clearly below its window mean — which adapts across illumination gradients
 * — or when it is far below the global Otsu threshold, which keeps the
 * inside of large ink regions (finder cores wider than the window) dark.
 * Tiny frames skip the windowing and use the Otsu threshold directly.
 */

/** Frames whose global luminance span is below this are treated as blank. */
const FLAT_SPAN = 16;
/** Frames with a side shorter than this are thresholded globally. */
const TINY_SIDE = 48;
/** Window half-size = shorter side / this divisor (clamped below). */
const WINDOW_DIVISOR = 10;
const WINDOW_HALF_MIN = 8;
const WINDOW_HALF_MAX = 40;

export function binarize(gray: GrayImage): BitImage {
  const { luma, width, height } = gray;
  const out = new BitImage(width, height);

  const tinyFrame = Math.min(width, height) < TINY_SIDE;

  // The histogram drives Otsu, whose optimum is a population statistic; on
  // frames big enough for the sliding window a quarter of the pixels
  // characterize it just as well.
  const histogramStep = tinyFrame ? 1 : 2;
  const histogram = new Uint32Array(256);
  let sampled = 0;
  for (let y = 0; y < height; y += histogramStep) {
    const row = y * width;
    for (let x = 0; x < width; x += histogramStep) {
      histogram[luma[row + x]!]!++;
      sampled++;
    }
  }
  let darkest = 0;
  while (darkest < 255 && histogram[darkest] === 0) darkest++;
  let brightest = 255;
  while (brightest > 0 && histogram[brightest] === 0) brightest--;
  // A featureless frame stays all-light rather than amplifying sensor noise.
  if (brightest - darkest < FLAT_SPAN) return out;

  const global = otsuThreshold(histogram, sampled);

  if (tinyFrame) {
    for (let i = 0; i < luma.length; i++) {
      if (luma[i]! < global) out.bits[i] = 1;
    }
    return out;
  }

  // Summed-area table over a 2×2-summed grid, with an implicit zero
  // row/column at the top/left so any rectangle sum is four lookups. The
  // window mean only varies at window scale, so half-resolution statistics
  // are indistinguishable at a quarter of the memory traffic. Uint32 is
  // exact below ~16.8 MP source pixels (1020 · cells < 2³²); larger frames
  // fall back to doubles.
  const gridWidth = width >> 1;
  const gridHeight = height >> 1;
  const stride = gridWidth + 1;
  const sat =
    width * height < 16_000_000
      ? new Uint32Array(stride * (gridHeight + 1))
      : new Float64Array(stride * (gridHeight + 1));
  for (let gy = 0; gy < gridHeight; gy++) {
    const rowA = 2 * gy * width;
    const rowB = rowA + width;
    const satRow = (gy + 1) * stride;
    const satAbove = gy * stride;
    let rowSum = 0;
    for (let gx = 0; gx < gridWidth; gx++) {
      const x = 2 * gx;
      rowSum += luma[rowA + x]! + luma[rowA + x + 1]! + luma[rowB + x]! + luma[rowB + x + 1]!;
      sat[satRow + gx + 1] = sat[satAbove + gx + 1]! + rowSum;
    }
  }

  const half = Math.min(
    WINDOW_HALF_MAX,
    Math.max(WINDOW_HALF_MIN, Math.round(Math.min(width, height) / WINDOW_DIVISOR)),
  );
  const deepDark = global >> 1;
  const bits = out.bits;

  // The threshold field varies on the scale of the window, so it is
  // evaluated once per small tile (a fraction of the window) rather than per
  // pixel; every pixel in the tile compares against its tile's cut. Window
  // bounds live in grid (half-resolution) coordinates.
  const gridHalf = Math.max(2, half >> 1);
  const tile = Math.max(2, half >> 3);
  for (let tileY = 0; tileY < height; tileY += tile) {
    const tileBottom = Math.min(tileY + tile, height);
    const gridCenterY = (tileY + (tile >> 1)) >> 1;
    const top = Math.max(0, gridCenterY - gridHalf);
    const bottom = Math.min(gridHeight, gridCenterY + gridHalf + 1);
    const satTop = top * stride;
    const satBottom = bottom * stride;
    const rowSpan = bottom - top;

    // #region snippet: binarize
    for (let tileX = 0; tileX < width; tileX += tile) {
      const tileRight = Math.min(tileX + tile, width);
      const gridCenterX = (tileX + (tile >> 1)) >> 1;
      const left = Math.max(0, gridCenterX - gridHalf);
      const right = Math.min(gridWidth, gridCenterX + gridHalf + 1);
      const windowSum =
        sat[satBottom + right]! -
        sat[satTop + right]! -
        sat[satBottom + left]! +
        sat[satTop + left]!;
      // Dark = 12.5% below the window mean, or deep below the global split.
      const mean = windowSum / (4 * (right - left) * rowSpan);
      const cut = Math.max((mean * 7) / 8, deepDark);

      for (let y = tileY; y < tileBottom; y++) {
        const row = y * width;
        for (let x = tileX; x < tileRight; x++) {
          if (luma[row + x]! < cut) bits[row + x] = 1;
        }
      }
    }
    // #endregion snippet
  }
  return out;
}

/**
 * Otsu's method (1979), from the definition: pick the threshold that
 * maximizes the between-class variance w₀·w₁·(μ₀−μ₁)² of the split. On a
 * clean bimodal histogram every cut through the empty valley scores the
 * same, so the midpoint of the optimal plateau is used.
 */
function otsuThreshold(histogram: Uint32Array, total: number): number {
  let sumAll = 0;
  for (let v = 0; v < 256; v++) sumAll += v * histogram[v]!;

  let plateauStart = 127;
  let plateauEnd = 127;
  let bestSpread = -1;
  let countBelow = 0;
  let sumBelow = 0;
  for (let t = 0; t < 256; t++) {
    countBelow += histogram[t]!;
    if (countBelow === 0) continue;
    const countAbove = total - countBelow;
    if (countAbove === 0) break;
    sumBelow += t * histogram[t]!;
    const gap = sumBelow / countBelow - (sumAll - sumBelow) / countAbove;
    const spread = countBelow * countAbove * gap * gap;
    if (spread > bestSpread) {
      bestSpread = spread;
      plateauStart = t;
      plateauEnd = t;
    } else if (spread === bestSpread) {
      plateauEnd = t;
    }
  }
  return ((plateauStart + plateauEnd) >> 1) + 1;
}
