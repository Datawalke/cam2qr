import { describe, expect, it } from 'vitest';
import { maskBit } from '../../src/core/mask.js';

describe('maskBit', () => {
  it('mask 0 is a checkerboard', () => {
    expect(maskBit(0, 0, 0)).toBe(true);
    expect(maskBit(0, 0, 1)).toBe(false);
    expect(maskBit(0, 1, 0)).toBe(false);
    expect(maskBit(0, 1, 1)).toBe(true);
  });

  it('mask 1 inverts every other row', () => {
    for (let col = 0; col < 5; col++) {
      expect(maskBit(1, 0, col)).toBe(true);
      expect(maskBit(1, 1, col)).toBe(false);
    }
  });

  it('mask 2 inverts every third column', () => {
    for (let row = 0; row < 5; row++) {
      expect(maskBit(2, row, 0)).toBe(true);
      expect(maskBit(2, row, 1)).toBe(false);
      expect(maskBit(2, row, 3)).toBe(true);
    }
  });

  it('evaluates the arithmetic masks per the spec formulas', () => {
    // Spot checks computed by hand from ISO/IEC 18004 §8.8.1.
    expect(maskBit(3, 2, 1)).toBe(true); // (2+1)%3 === 0
    expect(maskBit(4, 2, 3)).toBe(true); // (1+1)%2 === 0
    expect(maskBit(4, 2, 2)).toBe(false); // (1+0)%2 === 1
    expect(maskBit(5, 2, 3)).toBe(true); // 6%2 + 6%3 === 0
    expect(maskBit(5, 2, 2)).toBe(false); // 4%2 + 4%3 === 1
    expect(maskBit(6, 2, 3)).toBe(true); // (6%2 + 6%3)%2 === 0
    expect(maskBit(6, 2, 2)).toBe(false); // (4%2 + 4%3)%2 === 1
    expect(maskBit(7, 1, 1)).toBe(false); // (2%2 + 1%3)%2 = 1
  });

  it('rejects invalid mask ids', () => {
    expect(() => maskBit(8, 0, 0)).toThrow(RangeError);
    expect(() => maskBit(-1, 0, 0)).toThrow(RangeError);
  });
});
