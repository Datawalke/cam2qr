import { describe, expect, it } from 'vitest';
import { binarize } from '../../src/detect/binarizer.js';
import type { GrayImage } from '../../src/detect/grayscale.js';

function grayImage(width: number, height: number, at: (x: number, y: number) => number): GrayImage {
  const luma = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      luma[y * width + x] = at(x, y);
    }
  }
  return { luma, width, height };
}

describe('binarize', () => {
  it('separates ink from paper at moderate contrast', () => {
    const image = grayImage(120, 120, (x, y) =>
      x >= 30 && x < 90 && y >= 30 && y < 90 ? 45 : 210,
    );
    const bits = binarize(image);
    expect(bits.get(60, 60)).toBe(true);
    expect(bits.get(10, 10)).toBe(false);
    expect(bits.get(110, 110)).toBe(false);
  });

  it('tracks an illumination gradient across the frame', () => {
    // Fine checkerboard (12px cells) whose paper ramps from 240 down to 70;
    // ink sits at 30% of the local paper value. The dim side's paper (~70)
    // is darker than the lit side's ink (~72), so no global cut works.
    const cell = 12;
    const image = grayImage(240, 96, (x, y) => {
      const paper = 240 - (x / 240) * 170;
      const isInk = (Math.floor(x / cell) + Math.floor(y / cell)) % 2 === 0;
      return Math.round(isInk ? paper * 0.3 : paper);
    });
    const bits = binarize(image);
    for (const probeX of [6, 30, 198, 222]) {
      const inkColumn = Math.floor(probeX / cell) % 2 === 0;
      expect(bits.get(probeX, 6), `x=${probeX}`).toBe(inkColumn);
    }
  });

  it('keeps the middle of ink regions wider than the window dark', () => {
    // 300×300 blob in a 480px frame: the sliding window (≤ ~97px) fits
    // entirely inside it, so only the global-anchor rule can keep it dark.
    const image = grayImage(480, 480, (x, y) =>
      x >= 90 && x < 390 && y >= 90 && y < 390 ? 20 : 230,
    );
    const bits = binarize(image);
    expect(bits.get(240, 240)).toBe(true); // dead center of the blob
    expect(bits.get(100, 100)).toBe(true); // inside, near the edge
    expect(bits.get(40, 240)).toBe(false); // paper
  });

  it('thresholds tiny frames globally', () => {
    const image = grayImage(32, 32, (x) => (x < 16 ? 60 : 190));
    const bits = binarize(image);
    expect(bits.get(4, 16)).toBe(true);
    expect(bits.get(28, 16)).toBe(false);
  });

  it('treats a flat frame as blank instead of amplifying noise', () => {
    const image = grayImage(100, 100, (x, y) => 128 + ((x ^ y) & 3));
    const bits = binarize(image);
    let darkCount = 0;
    for (let i = 0; i < bits.bits.length; i++) darkCount += bits.bits[i]!;
    expect(darkCount).toBe(0);
  });

  it('handles low-contrast prints (compressed luminance range)', () => {
    const image = grayImage(120, 120, (x, y) =>
      (Math.floor(x / 10) + Math.floor(y / 10)) % 2 === 0 ? 105 : 175,
    );
    const bits = binarize(image);
    expect(bits.get(5, 5)).toBe(true);
    expect(bits.get(15, 5)).toBe(false);
  });

  it('inverted() flips every pixel of the result', () => {
    const image = grayImage(60, 60, (x) => (x < 30 ? 0 : 255));
    const bits = binarize(image);
    const flipped = bits.inverted();
    for (const [x, y] of [
      [2, 2],
      [45, 30],
      [29, 59],
    ] as const) {
      expect(flipped.get(x, y)).toBe(!bits.get(x, y));
    }
  });
});
