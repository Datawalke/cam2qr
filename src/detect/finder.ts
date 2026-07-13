import type { BitImage } from './bit-image.js';

/**
 * Finder-pattern location. Each scan row is run-length encoded and every
 * five-run dark window is tested against the 1:1:3:1:1 profile of ISO/IEC
 * 18004 §7.3.2 using a summed relative-deviation score. Horizontal hits are
 * confirmed by measuring the same profile vertically through the candidate
 * center, and confirmed sightings accumulate into clusters whose centroids
 * become the reported patterns. Triples of patterns are ranked by how well
 * they form the right-isosceles corner layout of a QR symbol.
 */

/** A confirmed 1:1:3:1:1 finder-pattern center in image coordinates. */
export interface FinderPattern {
  x: number;
  y: number;
  moduleSize: number;
  /** Number of scan rows that confirmed this center. */
  count: number;
}

/** A finder triple arranged as the corners of an upright symbol. */
export interface OrderedPatterns {
  topLeft: FinderPattern;
  topRight: FinderPattern;
  bottomLeft: FinderPattern;
}

/**
 * Largest accepted profile score: the summed absolute deviation of the five
 * runs from ideal 1:1:3:1:1, as a fraction of the total width.
 */
const PROFILE_CUTOFF = 0.25;
/** Horizontal and vertical module estimates may differ by this factor. */
const AXIS_AGREEMENT = 1.6;
/** Sightings required before a cluster counts as a pattern. */
const MIN_SIGHTINGS = 2;
/** Candidate pool size for triple ranking (strongest clusters first). */
const RANKING_POOL = 12;

interface Cluster {
  sumX: number;
  sumY: number;
  sumModule: number;
  count: number;
}

/** Scans the whole image and returns every plausible finder-pattern center. */
export function findFinderPatterns(image: BitImage): FinderPattern[] {
  const clusters: Cluster[] = [];
  const boundaries: number[] = [];
  for (let y = 0; y < image.height; y++) {
    scanRow(image, y, boundaries, clusters);
  }
  const patterns: FinderPattern[] = [];
  for (const cluster of clusters) {
    if (cluster.count < MIN_SIGHTINGS) continue;
    patterns.push({
      x: cluster.sumX / cluster.count,
      y: cluster.sumY / cluster.count,
      moduleSize: cluster.sumModule / cluster.count,
      count: cluster.count,
    });
  }
  return patterns;
}

/** Best triple of the candidate set, or null when none forms a symbol. */
export function selectBestPatterns(patterns: FinderPattern[]): OrderedPatterns | null {
  return rankTriples(patterns)[0] ?? null;
}

/** All plausible triples, best-scoring first. */
export function rankTriples(patterns: FinderPattern[]): OrderedPatterns[] {
  if (patterns.length < 3) return [];
  const pool = [...patterns]
    .sort((a, b) => b.count * b.moduleSize - a.count * a.moduleSize)
    .slice(0, RANKING_POOL);

  const scored: Array<{ score: number; ordered: OrderedPatterns }> = [];
  for (let i = 0; i < pool.length; i++) {
    for (let j = i + 1; j < pool.length; j++) {
      for (let k = j + 1; k < pool.length; k++) {
        const ordered = orderAsCorners(pool[i]!, pool[j]!, pool[k]!);
        const score = tripleScore(ordered);
        if (score !== null) scored.push({ score, ordered });
      }
    }
  }
  scored.sort((a, b) => a.score - b.score);
  return scored.map((entry) => entry.ordered);
}

/**
 * Run-length encodes one row and feeds every dark 5-run window through the
 * profile check plus vertical confirmation.
 */
function scanRow(image: BitImage, y: number, boundaries: number[], clusters: Cluster[]): void {
  const width = image.width;
  const rowBits = image.bits.subarray(y * width, (y + 1) * width);
  boundaries.length = 0;
  boundaries.push(0);
  let previous = rowBits[0]!;
  const rowStartsDark = previous !== 0;
  for (let x = 1; x < width; x++) {
    const bit = rowBits[x]!;
    if (bit !== previous) {
      boundaries.push(x);
      previous = bit;
    }
  }
  boundaries.push(width);

  const runCount = boundaries.length - 1;
  const firstDark = rowStartsDark ? 0 : 1;
  for (let run = firstDark; run + 5 <= runCount; run += 2) {
    const b0 = boundaries[run]!;
    const b1 = boundaries[run + 1]!;
    const b2 = boundaries[run + 2]!;
    const b3 = boundaries[run + 3]!;
    const b4 = boundaries[run + 4]!;
    const b5 = boundaries[run + 5]!;
    if (profileScore(b1 - b0, b2 - b1, b3 - b2, b4 - b3, b5 - b4) > PROFILE_CUTOFF) continue;

    const centerX = (b2 + b3) / 2;
    const horizontalSpan = b5 - b0;
    // A stray light pixel in the walked column would sink the whole
    // candidate, so nearby columns get a chance too.
    let confirmed: { centerY: number; span: number } | null = null;
    for (const jitter of [0, -1, 1, -2, 2]) {
      confirmed = confirmVertically(image, Math.floor(centerX) + jitter, y, horizontalSpan);
      if (confirmed !== null) break;
    }
    if (confirmed === null) continue;

    const moduleSize = (horizontalSpan + confirmed.span) / 14;
    recordSighting(clusters, centerX, confirmed.centerY, moduleSize);
  }
}

// #region snippet: finder-profile
/**
 * Relative deviation of five run lengths from 1:1:3:1:1 — the sum of
 * per-run absolute errors against a shared unit of total/7, normalized by
 * the total. 0 is a perfect match.
 */
function profileScore(a: number, b: number, c: number, d: number, e: number): number {
  const total = a + b + c + d + e;
  if (total < 7) return Number.POSITIVE_INFINITY;
  const unit = total / 7;
  const deviation =
    Math.abs(a - unit) +
    Math.abs(b - unit) +
    Math.abs(c - 3 * unit) +
    Math.abs(d - unit) +
    Math.abs(e - unit);
  return deviation / total;
}
// #endregion snippet

/**
 * Measures the five vertical runs through (x, y) — center dark run plus the
 * light and dark runs above and below it — and accepts when they match the
 * profile and roughly agree with the horizontal measurement.
 */
function confirmVertically(
  image: BitImage,
  x: number,
  y: number,
  horizontalSpan: number,
): { centerY: number; span: number } | null {
  if (!image.get(x, y)) return null;
  const height = image.height;

  // Walk up from y (inclusive) and down from y+1 through dark/light/dark.
  let top = y;
  while (top >= 0 && image.get(x, top)) top--;
  let lightTop = top;
  while (lightTop >= 0 && !image.get(x, lightTop)) lightTop--;
  let darkTop = lightTop;
  while (darkTop >= 0 && image.get(x, darkTop)) darkTop--;

  let bottom = y + 1;
  while (bottom < height && image.get(x, bottom)) bottom++;
  let lightBottom = bottom;
  while (lightBottom < height && !image.get(x, lightBottom)) lightBottom++;
  let darkBottom = lightBottom;
  while (darkBottom < height && image.get(x, darkBottom)) darkBottom++;

  const outerAbove = lightTop - darkTop;
  const lightAbove = top - lightTop;
  const center = bottom - top - 1;
  const lightBelow = lightBottom - bottom;
  const outerBelow = darkBottom - lightBottom;
  if (outerAbove === 0 || lightAbove === 0 || lightBelow === 0 || outerBelow === 0) return null;

  if (profileScore(outerAbove, lightAbove, center, lightBelow, outerBelow) > PROFILE_CUTOFF) {
    return null;
  }
  const span = outerAbove + lightAbove + center + lightBelow + outerBelow;
  const disagreement = Math.max(span, horizontalSpan) / Math.min(span, horizontalSpan);
  if (disagreement > AXIS_AGREEMENT) return null;

  // Continuous-coordinate midpoint of the central dark run.
  return { centerY: (top + 1 + bottom) / 2, span };
}

/** Folds a confirmed sighting into a nearby cluster, or starts a new one. */
function recordSighting(clusters: Cluster[], x: number, y: number, moduleSize: number): void {
  for (const cluster of clusters) {
    const cx = cluster.sumX / cluster.count;
    const cy = cluster.sumY / cluster.count;
    const cm = cluster.sumModule / cluster.count;
    if (
      Math.abs(x - cx) <= cm &&
      Math.abs(y - cy) <= cm &&
      Math.abs(moduleSize - cm) <= cm * 0.5 + 0.5
    ) {
      cluster.sumX += x;
      cluster.sumY += y;
      cluster.sumModule += moduleSize;
      cluster.count++;
      return;
    }
  }
  clusters.push({ sumX: x, sumY: y, sumModule: moduleSize, count: 1 });
}

/**
 * Arranges three patterns as symbol corners: the pattern opposite the
 * longest side is the top-left, and the cross product orients the other two
 * (image y grows downward).
 */
function orderAsCorners(a: FinderPattern, b: FinderPattern, c: FinderPattern): OrderedPatterns {
  const ab = squaredDistance(a, b);
  const bc = squaredDistance(b, c);
  const ac = squaredDistance(a, c);
  let corner: FinderPattern;
  let first: FinderPattern;
  let second: FinderPattern;
  if (bc >= ab && bc >= ac) {
    corner = a;
    first = b;
    second = c;
  } else if (ac >= ab) {
    corner = b;
    first = a;
    second = c;
  } else {
    corner = c;
    first = a;
    second = b;
  }
  const cross =
    (first.x - corner.x) * (second.y - corner.y) - (first.y - corner.y) * (second.x - corner.x);
  return cross > 0
    ? { topLeft: corner, topRight: first, bottomLeft: second }
    : { topLeft: corner, topRight: second, bottomLeft: first };
}

// #region snippet: triple-score
/**
 * Plausibility score for an ordered triple — lower is better, null rejects.
 * Combines module-size agreement, leg balance, the diagonal/leg ratio of a
 * right isosceles triangle, and the corner angle.
 */
function tripleScore(ordered: OrderedPatterns): number | null {
  const { topLeft, topRight, bottomLeft } = ordered;
  const sizes = [topLeft.moduleSize, topRight.moduleSize, bottomLeft.moduleSize];
  const meanSize = (sizes[0]! + sizes[1]! + sizes[2]!) / 3;
  const sizeSpread = (Math.max(...sizes) - Math.min(...sizes)) / meanSize;
  if (sizeSpread > 0.5) return null;

  const legTop = Math.hypot(topRight.x - topLeft.x, topRight.y - topLeft.y);
  const legSide = Math.hypot(bottomLeft.x - topLeft.x, bottomLeft.y - topLeft.y);
  const diagonal = Math.hypot(topRight.x - bottomLeft.x, topRight.y - bottomLeft.y);
  const legMean = (legTop + legSide) / 2;

  // Center spacing is dimension − 7 modules: 14 for version 1 up to 170.
  const spacingModules = legMean / meanSize;
  if (spacingModules < 9 || spacingModules > 185) return null;

  const legImbalance = Math.abs(legTop - legSide) / legMean;
  if (legImbalance > 0.6) return null;

  const diagonalError = Math.abs(diagonal - Math.SQRT2 * legMean) / diagonal;
  const cornerCos =
    ((topRight.x - topLeft.x) * (bottomLeft.x - topLeft.x) +
      (topRight.y - topLeft.y) * (bottomLeft.y - topLeft.y)) /
    (legTop * legSide);
  if (Math.abs(cornerCos) > 0.5) return null;

  return sizeSpread + legImbalance + 2 * diagonalError + Math.abs(cornerCos);
}
// #endregion snippet

function squaredDistance(a: FinderPattern, b: FinderPattern): number {
  return (a.x - b.x) ** 2 + (a.y - b.y) ** 2;
}
