import { describe, expect, it } from 'vitest';
import {
  alphaPow,
  gfDiv,
  gfInv,
  gfLog,
  gfMul,
  polyEval,
  polyMul,
  polyMulAddInto,
} from '../../src/core/gf256.js';

describe('GF(256) field operations', () => {
  it('generates the field from α = 2 modulo 0x11d', () => {
    expect(alphaPow(0)).toBe(1);
    expect(alphaPow(1)).toBe(2);
    expect(alphaPow(7)).toBe(0x80);
    // α^8 wraps: 0x100 reduced by the primitive polynomial leaves 0x1d.
    expect(alphaPow(8)).toBe(0x1d);
    // The multiplicative group has order 255.
    expect(alphaPow(255)).toBe(1);
    expect(alphaPow(-3)).toBe(alphaPow(252));
  });

  it('log and antilog are inverse bijections over the non-zero elements', () => {
    const seen = new Set<number>();
    for (let e = 0; e < 255; e++) {
      const v = alphaPow(e);
      seen.add(v);
      expect(gfLog(v)).toBe(e);
    }
    expect(seen.size).toBe(255);
    expect(() => gfLog(0)).toThrow(RangeError);
  });

  it('multiplication distributes over addition (XOR) on sampled elements', () => {
    for (let a = 3; a < 256; a += 29) {
      for (let b = 5; b < 256; b += 31) {
        for (let c = 7; c < 256; c += 37) {
          expect(gfMul(a, b ^ c)).toBe(gfMul(a, b) ^ gfMul(a, c));
        }
      }
    }
  });

  it('division and inversion undo multiplication', () => {
    for (let a = 1; a < 256; a++) {
      expect(gfMul(a, gfInv(a))).toBe(1);
      expect(gfDiv(gfMul(a, 113), 113)).toBe(a);
    }
    expect(gfMul(0, 200)).toBe(0);
    expect(gfDiv(0, 9)).toBe(0);
    expect(() => gfDiv(1, 0)).toThrow(RangeError);
    expect(() => gfInv(0)).toThrow(RangeError);
  });
});

describe('ascending-degree polynomial helpers', () => {
  it('polyEval evaluates with index-as-degree convention', () => {
    // p(x) = 5 + 3x + x², so p[0] is the constant term.
    const p = Uint8Array.of(5, 3, 1);
    expect(polyEval(p, 0)).toBe(5);
    expect(polyEval(p, 1)).toBe(5 ^ 3 ^ 1);
    expect(polyEval(p, 2)).toBe(5 ^ gfMul(3, 2) ^ gfMul(2, 2));
  });

  it('polyMul multiplies; cross terms cancel in characteristic 2', () => {
    const xPlus1 = Uint8Array.of(1, 1);
    expect(Array.from(polyMul(xPlus1, xPlus1))).toEqual([1, 0, 1]);
    const scaled = polyMul(Uint8Array.of(0, 7), Uint8Array.of(2, 0, 9));
    // 7x · (2 + 9x²) = 14x + 63x³ in field arithmetic
    expect(Array.from(scaled)).toEqual([0, gfMul(7, 2), 0, gfMul(7, 9)]);
  });

  it('polyMulAddInto shifts, scales, and truncates at the target length', () => {
    const target = Uint8Array.of(1, 1, 1, 1);
    polyMulAddInto(target, Uint8Array.of(2, 3, 4), 1, 2);
    expect(Array.from(target)).toEqual([1, 1, 1 ^ 2, 1 ^ 3]); // the 4 falls off the end
    const other = new Uint8Array(6);
    polyMulAddInto(other, Uint8Array.of(1, 1), 5, 1);
    expect(Array.from(other)).toEqual([0, 5, 5, 0, 0, 0]);
  });
});
