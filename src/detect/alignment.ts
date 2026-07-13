import type { Point } from '../types.js';
import type { BitImage } from './bit-image.js';

/**
 * Alignment-pattern search (ISO/IEC 18004 §7.3.5): the pattern is a 5×5
 * square whose central row reads dark–light–dark with every run one module
 * wide. Rows of a bounded window around the predicted position are
 * run-length scanned for that signature; hits are confirmed by the same
 * measurement turned vertical, and the confirmed center closest to the
 * prediction wins.
 */

/** Accepted summed relative deviation from the 1:1:1 profile. */
const CORE_CUTOFF = 0.45;

/**
 * Finds the alignment-pattern center near `expected`, searching a square
 * window of ±radius modules. Returns null when nothing convincing is there.
 */
export function findAlignmentPattern(
  image: BitImage,
  expected: Point,
  moduleSize: number,
  radiusModules: number,
): Point | null {
  const radius = Math.max(2, Math.round(radiusModules * moduleSize));
  const left = Math.max(0, Math.round(expected.x - radius));
  const right = Math.min(image.width - 1, Math.round(expected.x + radius));
  const top = Math.max(0, Math.round(expected.y - radius));
  const bottom = Math.min(image.height - 1, Math.round(expected.y + radius));
  if (right - left < 2 || bottom - top < 2) return null;

  let best: Point | null = null;
  let bestOffset = Number.POSITIVE_INFINITY;

  for (let y = top; y <= bottom; y++) {
    // Dark runs inside the window row, tracked as [start, end).
    let x = left;
    while (x <= right) {
      if (!image.get(x, y)) {
        x++;
        continue;
      }
      const darkStart = x;
      while (x <= right + 1 && x < image.width && image.get(x, y)) x++;
      const darkEnd = x;

      const center = coreMatches(image, darkStart, darkEnd, y, moduleSize);
      if (center === null) continue;

      const refined = confirmColumn(image, Math.floor(center), y, moduleSize);
      if (refined === null) continue;

      const offset = Math.hypot(center - expected.x, refined - expected.y);
      if (offset < bestOffset) {
        bestOffset = offset;
        best = { x: center, y: refined };
      }
    }
  }
  return best;
}

/**
 * Checks that a dark run and its flanking light runs form a plausible
 * module-sized 1:1:1 core; returns the dark run's midpoint on success.
 */
function coreMatches(
  image: BitImage,
  darkStart: number,
  darkEnd: number,
  y: number,
  moduleSize: number,
): number | null {
  const dark = darkEnd - darkStart;
  let lightLeft = 0;
  for (let x = darkStart - 1; x >= 0 && !image.get(x, y); x--) lightLeft++;
  let lightRight = 0;
  for (let x = darkEnd; x < image.width && !image.get(x, y); x++) lightRight++;
  if (lightLeft === 0 || lightRight === 0) return null;
  // The ring is one module; runs beyond one module mean this is not the core.
  const clampedLeft = Math.min(lightLeft, moduleSize * 2);
  const clampedRight = Math.min(lightRight, moduleSize * 2);
  const score =
    (Math.abs(dark - moduleSize) +
      Math.abs(clampedLeft - moduleSize) +
      Math.abs(clampedRight - moduleSize)) /
    (3 * moduleSize);
  return score <= CORE_CUTOFF ? (darkStart + darkEnd) / 2 : null;
}

/** Vertical version of the core check through (x, y); returns center y. */
function confirmColumn(image: BitImage, x: number, y: number, moduleSize: number): number | null {
  if (!image.get(x, y)) return null;
  const height = image.height;
  let top = y;
  while (top >= 0 && image.get(x, top)) top--;
  let bottom = y + 1;
  while (bottom < height && image.get(x, bottom)) bottom++;
  const dark = bottom - top - 1;

  let lightAbove = 0;
  for (let yy = top; yy >= 0 && !image.get(x, yy); yy--) lightAbove++;
  let lightBelow = 0;
  for (let yy = bottom; yy < height && !image.get(x, yy); yy++) lightBelow++;
  if (lightAbove === 0 || lightBelow === 0) return null;

  const clampedAbove = Math.min(lightAbove, moduleSize * 2);
  const clampedBelow = Math.min(lightBelow, moduleSize * 2);
  const score =
    (Math.abs(dark - moduleSize) +
      Math.abs(clampedAbove - moduleSize) +
      Math.abs(clampedBelow - moduleSize)) /
    (3 * moduleSize);
  return score <= CORE_CUTOFF ? (top + 1 + bottom) / 2 : null;
}
