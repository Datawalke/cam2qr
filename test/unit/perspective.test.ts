import { describe, expect, it } from 'vitest';
import { type Quad, applyHomography, computeHomography } from '../../src/detect/perspective.js';
import type { Point } from '../../src/types.js';

function expectNear(actual: Point, expected: Point, tolerance = 1e-9): void {
  expect(Math.abs(actual.x - expected.x)).toBeLessThan(tolerance);
  expect(Math.abs(actual.y - expected.y)).toBeLessThan(tolerance);
}

const UNIT_SQUARE: Quad = [
  { x: 0, y: 0 },
  { x: 1, y: 0 },
  { x: 1, y: 1 },
  { x: 0, y: 1 },
];

describe('computeHomography / applyHomography', () => {
  it('reproduces all four corner correspondences exactly', () => {
    const from: Quad = [
      { x: 3.5, y: 3.5 },
      { x: 21.5, y: 3.5 },
      { x: 18.5, y: 18.5 },
      { x: 3.5, y: 21.5 },
    ];
    const to: Quad = [
      { x: 50, y: 40 },
      { x: 200, y: 60 },
      { x: 190, y: 220 },
      { x: 40, y: 210 },
    ];
    const h = computeHomography(from, to)!;
    expect(h).not.toBeNull();
    for (let i = 0; i < 4; i++) {
      expectNear(applyHomography(h, from[i]!.x, from[i]!.y), to[i]!, 1e-6);
    }
  });

  it('reduces to the exact affine map for parallelogram targets', () => {
    // Scale ×3, translate (−2, 4): affine, so every point maps exactly.
    const to: Quad = [
      { x: -2, y: 4 },
      { x: 1, y: 4 },
      { x: 1, y: 7 },
      { x: -2, y: 7 },
    ];
    const h = computeHomography(UNIT_SQUARE, to)!;
    expectNear(applyHomography(h, 0.5, 0.5), { x: -0.5, y: 5.5 });
    expectNear(applyHomography(h, -4, 9), { x: -14, y: 31 }, 1e-6);
    // Affine maps have no perspective terms.
    expect(Math.abs(h[6]!)).toBeLessThan(1e-12);
    expect(Math.abs(h[7]!)).toBeLessThan(1e-12);
  });

  it('keeps interior points interior under a projective warp', () => {
    const to: Quad = [
      { x: 0, y: 0 },
      { x: 100, y: 10 },
      { x: 90, y: 80 },
      { x: 10, y: 100 },
    ];
    const h = computeHomography(UNIT_SQUARE, to)!;
    const mid = applyHomography(h, 0.5, 0.5);
    expect(mid.x).toBeGreaterThan(10);
    expect(mid.x).toBeLessThan(90);
    expect(mid.y).toBeGreaterThan(10);
    expect(mid.y).toBeLessThan(90);
  });

  it('inverse solve undoes the forward map', () => {
    const quad: Quad = [
      { x: 12, y: 8 },
      { x: 140, y: 25 },
      { x: 130, y: 150 },
      { x: 5, y: 120 },
    ];
    const forward = computeHomography(UNIT_SQUARE, quad)!;
    const backward = computeHomography(quad, UNIT_SQUARE)!;
    for (const [x, y] of [
      [0.25, 0.25],
      [0.9, 0.1],
      [0.5, 0.75],
    ] as const) {
      const there = applyHomography(forward, x, y);
      expectNear(applyHomography(backward, there.x, there.y), { x, y }, 1e-9);
    }
  });

  it('returns null for degenerate (collinear) corners', () => {
    const flat: Quad = [
      { x: 0, y: 0 },
      { x: 1, y: 1 },
      { x: 2, y: 2 },
      { x: 3, y: 3 },
    ];
    expect(computeHomography(UNIT_SQUARE, flat)).toBeNull();
    expect(computeHomography(flat, UNIT_SQUARE)).toBeNull();
  });
});
