import { describe, expect, it } from 'vitest';
import { encodeFormatInfo } from '../../src/core/bch.js';
import { BitMatrix } from '../../src/core/bit-matrix.js';
import { decodeMatrix } from '../../src/core/decode-matrix.js';
import { readVersionInformation } from '../../src/core/format.js';
import { buildFunctionPatternMap } from '../../src/core/function-pattern.js';
import { DecodeError } from '../../src/errors.js';
import type { ErrorCorrectionLevel } from '../../src/types.js';
import { generate, mulberry32 } from '../helpers/generate.js';

const LEVELS: ErrorCorrectionLevel[] = ['L', 'M', 'Q', 'H'];

describe('round-trip: qrcode generator → our decoder', () => {
  it('decodes every version × error correction level', () => {
    for (let version = 1; version <= 40; version++) {
      for (const level of LEVELS) {
        const payload = `v${version}${level}`;
        const qr = generate(payload, { version, level });
        const result = decodeMatrix(qr.matrix);
        expect(result.text, `version ${version}${level}`).toBe(payload);
        expect(result.version).toBe(version);
        expect(result.errorCorrectionLevel).toBe(level);
        expect(result.mask).toBe(qr.mask);
        expect(result.ecc.codewordsCorrected).toBe(0);
      }
    }
  });

  it('decodes all eight mask patterns', () => {
    for (let mask = 0; mask < 8; mask++) {
      const qr = generate(`MASK ${mask}`, { version: 2, level: 'M', mask });
      expect(qr.mask).toBe(mask);
      const result = decodeMatrix(qr.matrix);
      expect(result.text).toBe(`MASK ${mask}`);
      expect(result.mask).toBe(mask);
    }
  });

  it('decodes numeric-mode payloads', () => {
    const payload = '31415926535897932384626433';
    const result = decodeMatrix(generate(payload, { level: 'Q' }).matrix);
    expect(result.text).toBe(payload);
    expect(result.segments.some((s) => s.mode === 'numeric')).toBe(true);
  });

  it('decodes alphanumeric-mode payloads', () => {
    const payload = 'HELLO WORLD 123 $%*+-./:';
    const result = decodeMatrix(generate(payload, { level: 'Q' }).matrix);
    expect(result.text).toBe(payload);
    expect(result.segments.some((s) => s.mode === 'alphanumeric')).toBe(true);
  });

  it('decodes UTF-8 byte-mode payloads', () => {
    const payload = 'héllo wörld 🎉 日本語テスト';
    const result = decodeMatrix(generate(payload, { level: 'M' }).matrix);
    expect(result.text).toBe(payload);
  });

  it('decodes URLs (the most common real payload)', () => {
    const payload = 'https://example.com/path?a=1&b=two#frag';
    const result = decodeMatrix(generate(payload, { level: 'M' }).matrix);
    expect(result.text).toBe(payload);
  });

  it('decodes binary byte-mode payloads', () => {
    const bytes = Uint8Array.from({ length: 64 }, (_, i) => (i * 37 + 5) & 0xff);
    const qr = generate([{ data: bytes, mode: 'byte' }], { level: 'M' });
    const result = decodeMatrix(qr.matrix);
    expect(result.bytes).toEqual(bytes);
  });

  it('reads the version information blocks on large symbols', () => {
    for (const version of [7, 12, 23, 40]) {
      const qr = generate(`v${version}`, { version, level: 'M' });
      expect(readVersionInformation(qr.matrix)).toBe(version);
    }
  });

  it('recovers from damaged data modules via Reed–Solomon', () => {
    const payload = 'damage resistance test payload';
    const qr = generate(payload, { version: 5, level: 'H' });
    const functionMap = buildFunctionPatternMap(qr.version);
    const random = mulberry32(42);
    const damaged = qr.matrix.clone();

    let flipped = 0;
    while (flipped < 8) {
      const x = Math.floor(random() * damaged.size);
      const y = Math.floor(random() * damaged.size);
      if (functionMap.get(x, y)) continue;
      damaged.set(x, y, !damaged.get(x, y));
      flipped++;
    }

    const result = decodeMatrix(damaged);
    expect(result.text).toBe(payload);
    expect(result.ecc.codewordsCorrected).toBeGreaterThan(0);
  });

  it('survives 3 bit errors in each format information copy', () => {
    const payload = 'format damage';
    const qr = generate(payload, { version: 2, level: 'M' });
    const damaged = qr.matrix.clone();
    const size = damaged.size;
    // Copy 1 lives around the top-left finder; copy 2 is split between the
    // other two finders. Flip 3 bits of each (≤3 is correctable per copy).
    for (const [x, y] of [
      [0, 8],
      [2, 8],
      [8, 4],
    ] as const) {
      damaged.set(x, y, !damaged.get(x, y));
    }
    for (const [x, y] of [
      [8, size - 1],
      [8, size - 3],
      [size - 2, 8],
    ] as const) {
      damaged.set(x, y, !damaged.get(x, y));
    }
    const result = decodeMatrix(damaged);
    expect(result.text).toBe(payload);
    expect(result.errorCorrectionLevel).toBe('M');
    expect(result.mask).toBe(qr.mask);
  });

  it('recovers when one format copy is damaged into a different valid codeword', () => {
    const payload = 'format shadowing';
    const qr = generate(payload, { version: 2, level: 'M' });
    const damaged = qr.matrix.clone();
    // Overwrite copy 1 with a reading one bit away from a *wrong* codeword
    // (level H, different mask). Alone that reading "decodes" cleanly to the
    // wrong value; the pristine copy 2 must win the joint decode.
    const wrongData = (0b10 << 3) | ((qr.mask + 3) % 8);
    const misleading = encodeFormatInfo(wrongData) ^ 0b1;
    const copy1Modules: ReadonlyArray<readonly [number, number]> = [
      [0, 8],
      [1, 8],
      [2, 8],
      [3, 8],
      [4, 8],
      [5, 8],
      [7, 8],
      [8, 8],
      [8, 7],
      [8, 5],
      [8, 4],
      [8, 3],
      [8, 2],
      [8, 1],
      [8, 0],
    ];
    copy1Modules.forEach(([x, y], i) => {
      damaged.set(x, y, ((misleading >> (14 - i)) & 1) === 1);
    });
    const result = decodeMatrix(damaged);
    expect(result.text).toBe(payload);
    expect(result.errorCorrectionLevel).toBe('M');
    expect(result.mask).toBe(qr.mask);
  });

  it('throws a DecodeError on garbage input', () => {
    const random = mulberry32(7);
    const matrix = new BitMatrix(25);
    for (let y = 0; y < 25; y++) {
      for (let x = 0; x < 25; x++) {
        matrix.set(x, y, random() < 0.5);
      }
    }
    expect(() => decodeMatrix(matrix)).toThrow(DecodeError);
  });

  it('throws on invalid matrix sizes', () => {
    expect(() => decodeMatrix(new BitMatrix(20))).toThrow(DecodeError);
    try {
      decodeMatrix(new BitMatrix(20));
    } catch (error) {
      expect((error as DecodeError).code).toBe('invalid-dimension');
    }
  });
});
