import { describe, expect, it } from 'vitest';
import {
  decodeFormatBits,
  decodeVersionBits,
  encodeFormatInfo,
  encodeVersionInfo,
} from '../../src/core/bch.js';

describe('format information BCH', () => {
  it('matches the ISO/IEC 18004 reference vector', () => {
    // EC level L (01), mask 100 → data 01100 → 110011000101111.
    expect(encodeFormatInfo(0b01100)).toBe(0b110011000101111);
  });

  it('round-trips all 32 format values', () => {
    for (let data = 0; data < 32; data++) {
      expect(decodeFormatBits(encodeFormatInfo(data))).toBe(data);
    }
  });

  it('corrects up to 3 bit errors', () => {
    for (let data = 0; data < 32; data++) {
      const codeword = encodeFormatInfo(data);
      expect(decodeFormatBits(codeword ^ 0b1)).toBe(data);
      expect(decodeFormatBits(codeword ^ 0b101)).toBe(data);
      expect(decodeFormatBits(codeword ^ 0b100000000000101)).toBe(data);
    }
  });

  it('a clean second copy overrides a copy damaged toward a different codeword', () => {
    // 4+ bit errors can carry a reading inside the 3-bit acceptance radius
    // of a *wrong* codeword. Alone, that reading decodes to the wrong value;
    // decoded jointly, the pristine copy is nearer and must win.
    for (let data = 0; data < 32; data++) {
      const clean = encodeFormatInfo(data);
      const wrongData = (data + 13) % 32;
      const misleading = encodeFormatInfo(wrongData) ^ 0b1;
      expect(decodeFormatBits(misleading)).toBe(wrongData);
      expect(decodeFormatBits(misleading, clean)).toBe(data);
      expect(decodeFormatBits(clean, misleading)).toBe(data);
    }
  });

  it('decodes a pair where both copies carry correctable damage', () => {
    for (let data = 0; data < 32; data++) {
      const codeword = encodeFormatInfo(data);
      expect(decodeFormatBits(codeword ^ 0b110, codeword ^ 0b101000)).toBe(data);
    }
  });

  it('returns null when both copies are beyond correction', () => {
    // A reading ≥4 bits from every codeword exists (32 radius-3 balls cover
    // only 18432 of the 32768 possible readings); the pair decoder must
    // reject it just like the single-copy decoder does.
    let heavy: number | null = null;
    for (let bits = 0; bits < 1 << 15 && heavy === null; bits++) {
      if (decodeFormatBits(bits) === null) heavy = bits;
    }
    expect(heavy).not.toBeNull();
    expect(decodeFormatBits(heavy!, heavy!)).toBeNull();
  });

  it('valid format codewords are pairwise distant enough to correct 3 errors', () => {
    const codewords = Array.from({ length: 32 }, (_, d) => encodeFormatInfo(d));
    for (let i = 0; i < 32; i++) {
      for (let j = i + 1; j < 32; j++) {
        let x = codewords[i]! ^ codewords[j]!;
        let distance = 0;
        while (x) {
          x &= x - 1;
          distance++;
        }
        expect(distance).toBeGreaterThanOrEqual(7);
      }
    }
  });
});

describe('version information BCH', () => {
  it('matches the ISO/IEC 18004 Annex D vector for version 7', () => {
    expect(encodeVersionInfo(7)).toBe(0b000111110010010100);
  });

  it('round-trips versions 7..40 and corrects up to 3 bit errors', () => {
    for (let version = 7; version <= 40; version++) {
      const codeword = encodeVersionInfo(version);
      expect(decodeVersionBits(codeword)).toBe(version);
      expect(decodeVersionBits(codeword ^ 0b1)).toBe(version);
      expect(decodeVersionBits(codeword ^ 0b10000000000000001)).toBe(version);
      expect(decodeVersionBits(codeword ^ 0b100000001000000001)).toBe(version);
    }
  });

  it('a clean second copy overrides a copy damaged toward a different version', () => {
    for (let version = 7; version <= 40; version++) {
      const clean = encodeVersionInfo(version);
      const wrongVersion = version === 40 ? 7 : version + 1;
      const misleading = encodeVersionInfo(wrongVersion) ^ 0b10;
      expect(decodeVersionBits(misleading)).toBe(wrongVersion);
      expect(decodeVersionBits(misleading, clean)).toBe(version);
      expect(decodeVersionBits(clean, misleading)).toBe(version);
    }
  });
});
