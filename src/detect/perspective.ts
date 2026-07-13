import type { Point } from '../types.js';

/**
 * Plane-to-plane projective mapping between two quadrilaterals. The 3×3
 * homography H (bottom-right entry pinned to 1) is found by writing the four
 * corner correspondences as the standard system of eight linear equations in
 * H's remaining entries and solving it with Gaussian elimination — the
 * direct-linear-transformation approach described in textbooks on projective
 * geometry (e.g. Hartley & Zisserman, "Multiple View Geometry in Computer
 * Vision", §4.1).
 */

export type Quad = readonly [Point, Point, Point, Point];

/** Row-major 3×3 matrix; h[8] is always 1. */
export type Homography = Float64Array;

// #region snippet: homography
/**
 * Homography taking each `from[i]` to `to[i]`. Returns null for degenerate
 * input (e.g. three collinear corners), where no projective map exists.
 */
export function computeHomography(from: Quad, to: Quad): Homography | null {
  // A correspondence (x,y) → (u,v) linearizes to two equations in the
  // unknown vector [h0 … h7]:
  //   x·h0 + y·h1 + h2 − u·x·h6 − u·y·h7 = u
  //   x·h3 + y·h4 + h5 − v·x·h6 − v·y·h7 = v
  const rows: number[][] = [];
  for (let i = 0; i < 4; i++) {
    const { x, y } = from[i]!;
    const { x: u, y: v } = to[i]!;
    rows.push([x, y, 1, 0, 0, 0, -u * x, -u * y, u]);
    rows.push([0, 0, 0, x, y, 1, -v * x, -v * y, v]);
  }
  const solution = solveLinearSystem(rows);
  if (solution === null) return null;

  const h = new Float64Array(9);
  h.set(solution);
  h[8] = 1;
  return h;
}
// #endregion snippet

/** Applies the homography to a point (perspective divide included). */
export function applyHomography(h: Homography, x: number, y: number): Point {
  const w = h[6]! * x + h[7]! * y + 1;
  return {
    x: (h[0]! * x + h[1]! * y + h[2]!) / w,
    y: (h[3]! * x + h[4]! * y + h[5]!) / w,
  };
}

/**
 * Solves an n×n system given as n rows of n+1 augmented coefficients, by
 * Gaussian elimination with partial pivoting. Returns null when singular.
 * The input rows are consumed (modified in place).
 */
function solveLinearSystem(rows: number[][]): number[] | null {
  const n = rows.length;
  for (let col = 0; col < n; col++) {
    let pivotRow = col;
    for (let r = col + 1; r < n; r++) {
      if (Math.abs(rows[r]![col]!) > Math.abs(rows[pivotRow]![col]!)) pivotRow = r;
    }
    const pivot = rows[pivotRow]![col]!;
    if (Math.abs(pivot) < 1e-12) return null;
    if (pivotRow !== col) {
      const swap = rows[col]!;
      rows[col] = rows[pivotRow]!;
      rows[pivotRow] = swap;
    }
    const lead = rows[col]!;
    for (let r = col + 1; r < n; r++) {
      const row = rows[r]!;
      const factor = row[col]! / pivot;
      if (factor === 0) continue;
      for (let c = col; c <= n; c++) {
        row[c]! -= factor * lead[c]!;
      }
    }
  }
  const solution = new Array<number>(n);
  for (let r = n - 1; r >= 0; r--) {
    const row = rows[r]!;
    let value = row[n]!;
    for (let c = r + 1; c < n; c++) {
      value -= row[c]! * solution[c]!;
    }
    solution[r] = value / row[r]!;
  }
  return solution;
}
