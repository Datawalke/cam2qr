import { describe, expect, it } from 'vitest';
import { BitReader } from '../../src/core/bitstream.js';
import { DecodeError } from '../../src/errors.js';

describe('BitReader', () => {
  it('reads MSB-first within and across bytes', () => {
    const reader = new BitReader(Uint8Array.from([0b1011_0011, 0b1100_0001]));
    expect(reader.read(1)).toBe(1);
    expect(reader.read(3)).toBe(0b011);
    expect(reader.read(8)).toBe(0b0011_1100); // spans the byte boundary
    expect(reader.available()).toBe(4);
    expect(reader.read(4)).toBe(0b0001);
    expect(reader.available()).toBe(0);
  });

  it('reads wide values', () => {
    const reader = new BitReader(Uint8Array.from([0x12, 0x34, 0x56, 0x78]));
    expect(reader.read(32)).toBe(0x12345678);
  });

  it('throws a DecodeError on overread, leaving the reader usable', () => {
    // Exhaustion comes from (possibly miscorrected) symbol data, so it must
    // surface as DecodeError — decode() swallows those and returns null.
    const reader = new BitReader(Uint8Array.from([0xff]));
    reader.read(6);
    expect(() => reader.read(3)).toThrow(DecodeError);
    try {
      reader.read(3);
    } catch (error) {
      expect((error as DecodeError).code).toBe('bitstream');
    }
    expect(reader.read(2)).toBe(0b11);
  });

  it('throws a RangeError for out-of-range widths (caller bug)', () => {
    const reader = new BitReader(Uint8Array.from([0xff, 0xff, 0xff, 0xff, 0xff]));
    expect(() => reader.read(0)).toThrow(RangeError);
    expect(() => reader.read(33)).toThrow(RangeError);
  });
});
