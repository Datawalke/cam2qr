import { BitMatrix } from '../core/bit-matrix.js';
import { readVersionInformation } from '../core/format.js';
import { sizeForVersion } from '../core/version.js';
import { DecodeError } from '../errors.js';
import type { Point } from '../types.js';
import { findAlignmentPattern } from './alignment.js';
import type { BitImage } from './bit-image.js';
import { type OrderedPatterns, findFinderPatterns, rankTriples } from './finder.js';
import { type Homography, type Quad, applyHomography, computeHomography } from './perspective.js';

/**
 * Turns a binarized image into sampled QR bit matrices. For each ranked
 * finder triple: the symbol version is estimated from the center spacing
 * (centers sit dimension − 7 modules apart), the timing patterns are sampled
 * as a validity check, the bottom-right alignment pattern (versions ≥ 2)
 * anchors the fourth homography correspondence with a parallelogram
 * fallback, and module centers are sampled through the homography.
 */

export interface DetectionResult {
  matrix: BitMatrix;
  /** Symbol outline: top-left, top-right, bottom-right, bottom-left. */
  cornerPoints: [Point, Point, Point, Point];
  moduleSize: number;
  patterns: OrderedPatterns;
}

/** Finder centers sit 3.5 modules inside the symbol corners (§7.3.2). */
const FINDER_INSET = 3.5;
/** The bottom-right alignment center sits 6.5 modules inside (Annex E). */
const ALIGNMENT_INSET = 6.5;
/** Modules of slack between the estimated and nominal dimension. */
const DIMENSION_SLACK = 2.5;
/** Search radius around the predicted alignment position, in modules. */
const ALIGNMENT_RADIUS = 5;
/** Minimum fraction of timing-pattern modules that must alternate. */
const TIMING_AGREEMENT = 0.7;

/** Decodes the most promising symbol candidate or throws DecodeError. */
export function detect(image: BitImage): DetectionResult {
  for (const detection of iterateDetections(image, 4)) {
    return detection;
  }
  throw new DecodeError('detect', 'no qr symbol found in the image');
}

/** Up to maxCandidates distinct symbol candidates, best first. */
export function detectCandidates(image: BitImage, maxCandidates: number): DetectionResult[] {
  const results: DetectionResult[] = [];
  for (const detection of iterateDetections(image, Math.max(4, maxCandidates * 2))) {
    results.push(detection);
    if (results.length >= maxCandidates) break;
  }
  return results;
}

/**
 * Lazily yields detections for ranked finder triples, spending at most
 * maxTriples attempts. The FinderPattern objects inside each result come
 * from one findFinderPatterns pass, so callers can use them as stable keys.
 */
export function* iterateDetections(
  image: BitImage,
  maxTriples: number,
): Generator<DetectionResult> {
  const patterns = findFinderPatterns(image);
  const triples = rankTriples(patterns);
  const budget = Math.min(triples.length, maxTriples);
  for (let i = 0; i < budget; i++) {
    const detection = assembleDetection(image, triples[i]!);
    if (detection !== null) yield detection;
  }
}

function assembleDetection(image: BitImage, patterns: OrderedPatterns): DetectionResult | null {
  const { topLeft, topRight, bottomLeft } = patterns;

  // Module size measured along each symbol axis: scan-line estimates are
  // stretched by rotation, but the finder's edge profile along the line
  // toward the opposite finder is not.
  const moduleAcross =
    axisModuleSize(image, topLeft, topRight) ?? (topLeft.moduleSize + topRight.moduleSize) / 2;
  const moduleDown =
    axisModuleSize(image, topLeft, bottomLeft) ?? (topLeft.moduleSize + bottomLeft.moduleSize) / 2;
  const moduleSize = (moduleAcross + moduleDown) / 2;
  if (moduleSize < 1) return null;

  // Version from center spacing: distance / moduleSize ≈ dimension − 7.
  const acrossModules = Math.hypot(topRight.x - topLeft.x, topRight.y - topLeft.y) / moduleAcross;
  const downModules = Math.hypot(bottomLeft.x - topLeft.x, bottomLeft.y - topLeft.y) / moduleDown;
  const estimatedDimension = (acrossModules + downModules) / 2 + 7;

  // The measurement error grows with the module count, so nearby versions
  // are tried closest-first; the timing-pattern gate arbitrates.
  for (const version of candidateVersions(estimatedDimension)) {
    const detection = buildAtVersion(image, patterns, moduleSize, version);
    if (detection !== null) return detection;
  }
  return null;
}

/** Valid versions whose nominal dimension is near the estimate, nearest first. */
function candidateVersions(estimatedDimension: number): number[] {
  const nearest = Math.round((estimatedDimension - 17) / 4);
  const versions: number[] = [];
  for (const version of [nearest, nearest - 1, nearest + 1]) {
    if (version < 1 || version > 40) continue;
    if (Math.abs(estimatedDimension - sizeForVersion(version)) > DIMENSION_SLACK) continue;
    versions.push(version);
  }
  return versions;
}

/**
 * Walks from a finder center toward the other finder, reading the distances
 * of the core→ring→rim→outside transitions, which sit at 1.5, 2.5 and 3.5
 * modules along a symbol axis. Averages the walks from both ends.
 */
function axisModuleSize(image: BitImage, from: Point, to: Point): number | null {
  const forward = edgeProfileModule(image, from, to);
  const backward = edgeProfileModule(image, to, from);
  if (forward === null || backward === null) return forward ?? backward;
  return (forward + backward) / 2;
}

// #region snippet: module-size
function edgeProfileModule(image: BitImage, from: Point, to: Point): number | null {
  const distance = Math.hypot(to.x - from.x, to.y - from.y);
  if (distance === 0) return null;
  const stepX = (to.x - from.x) / distance;
  const stepY = (to.y - from.y) / distance;
  const limit = Math.min(distance / 2, image.width + image.height);

  // Transition distances from the center: 3 dark→light or light→dark flips.
  const flips: number[] = [];
  let previous = true; // walking out of the dark core
  for (let t = 0.5; t < limit && flips.length < 3; t += 0.5) {
    const x = Math.floor(from.x + stepX * t);
    const y = Math.floor(from.y + stepY * t);
    if (x < 0 || x >= image.width || y < 0 || y >= image.height) break;
    const dark = image.get(x, y);
    if (dark !== previous) {
      flips.push(t - 0.25);
      previous = dark;
    }
  }
  if (flips.length < 3) return null;
  // flips = [1.5, 2.5, 3.5] modules from the center.
  return (flips[0]! / 1.5 + (flips[1]! - flips[0]!) + (flips[2]! - flips[1]!)) / 3;
}
// #endregion snippet

function buildAtVersion(
  image: BitImage,
  patterns: OrderedPatterns,
  moduleSize: number,
  version: number,
): DetectionResult | null {
  const { topLeft, topRight, bottomLeft } = patterns;
  const dimension = sizeForVersion(version);

  // Fourth correspondence: alignment pattern if the version has one and it
  // shows up near its predicted spot, else the parallelogram completion.
  let sourceBottomRight: Point = {
    x: dimension - FINDER_INSET,
    y: dimension - FINDER_INSET,
  };
  let imageBottomRight: Point = {
    x: topRight.x + bottomLeft.x - topLeft.x,
    y: topRight.y + bottomLeft.y - topLeft.y,
  };
  if (version >= 2) {
    // Fraction of the finder-to-finder span at which the alignment center
    // sits, applied along both symbol axes.
    const fraction = (dimension - FINDER_INSET - ALIGNMENT_INSET) / (dimension - 7);
    const predicted: Point = {
      x: topLeft.x + fraction * (topRight.x - topLeft.x + bottomLeft.x - topLeft.x),
      y: topLeft.y + fraction * (topRight.y - topLeft.y + bottomLeft.y - topLeft.y),
    };
    const found = findAlignmentPattern(image, predicted, moduleSize, ALIGNMENT_RADIUS);
    if (found !== null) {
      sourceBottomRight = { x: dimension - ALIGNMENT_INSET, y: dimension - ALIGNMENT_INSET };
      imageBottomRight = found;
    }
  }

  const moduleQuad: Quad = [
    { x: FINDER_INSET, y: FINDER_INSET },
    { x: dimension - FINDER_INSET, y: FINDER_INSET },
    sourceBottomRight,
    { x: FINDER_INSET, y: dimension - FINDER_INSET },
  ];
  const imageQuad: Quad = [
    { x: topLeft.x, y: topLeft.y },
    { x: topRight.x, y: topRight.y },
    imageBottomRight,
    { x: bottomLeft.x, y: bottomLeft.y },
  ];
  const homography = computeHomography(moduleQuad, imageQuad);
  if (homography === null) return null;

  if (!timingPatternsAgree(image, homography, dimension)) return null;

  const matrix = sampleModules(image, homography, dimension);
  if (matrix === null) return null;

  // Versions 7+ declare their version in two BCH-protected blocks (§8.10).
  // A legible disagreement means the triple was fit at the wrong dimension;
  // unreadable blocks fall back to the timing gate that already passed.
  if (version >= 7) {
    const declared = readVersionInformation(matrix);
    if (declared !== null && declared !== version) return null;
  }

  const cornerPoints: [Point, Point, Point, Point] = [
    applyHomography(homography, 0, 0),
    applyHomography(homography, dimension, 0),
    applyHomography(homography, dimension, dimension),
    applyHomography(homography, 0, dimension),
  ];
  for (const corner of cornerPoints) {
    if (!Number.isFinite(corner.x) || !Number.isFinite(corner.y)) return null;
  }

  return { matrix, cornerPoints, moduleSize, patterns };
}

/**
 * Samples the horizontal and vertical timing patterns (row/column 6, §7.3.4)
 * and checks that enough modules carry the expected dark/light alternation —
 * a cheap witness that the triple really spans one symbol at this version.
 */
function timingPatternsAgree(image: BitImage, h: Homography, dimension: number): boolean {
  let agreements = 0;
  let total = 0;
  for (let module = 8; module <= dimension - 9; module++) {
    const expectDark = module % 2 === 0;
    if (sampleAt(image, h, module + 0.5, 6.5) === expectDark) agreements++;
    if (sampleAt(image, h, 6.5, module + 0.5) === expectDark) agreements++;
    total += 2;
  }
  return total === 0 || agreements >= total * TIMING_AGREEMENT;
}

function sampleAt(image: BitImage, h: Homography, mx: number, my: number): boolean {
  const point = applyHomography(h, mx, my);
  const x = Math.floor(point.x);
  const y = Math.floor(point.y);
  if (x < 0 || x >= image.width || y < 0 || y >= image.height) return false;
  return image.get(x, y);
}

// #region snippet: sample-grid
/**
 * Reads every module center through the homography. Gives up when too many
 * centers land outside the frame (a wildly wrong fit, not a symbol).
 */
function sampleModules(image: BitImage, h: Homography, dimension: number): BitMatrix | null {
  const matrix = new BitMatrix(dimension);
  const width = image.width;
  const height = image.height;
  let escaped = 0;
  const escapeLimit = Math.ceil((dimension * dimension) / 8);
  for (let my = 0; my < dimension; my++) {
    for (let mx = 0; mx < dimension; mx++) {
      const point = applyHomography(h, mx + 0.5, my + 0.5);
      let x = Math.floor(point.x);
      let y = Math.floor(point.y);
      if (x < 0 || x >= width || y < 0 || y >= height) {
        if (++escaped > escapeLimit) return null;
        x = Math.min(width - 1, Math.max(0, x));
        y = Math.min(height - 1, Math.max(0, y));
      }
      matrix.set(mx, my, image.get(x, y));
    }
  }
  return matrix;
}
// #endregion snippet
