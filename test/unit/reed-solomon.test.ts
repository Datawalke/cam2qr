import { describe, expect, it } from 'vitest';
import { alphaPow, gfMul, polyEval } from '../../src/core/gf256.js';
import { rsCorrect } from '../../src/core/reed-solomon.js';
import { rsEncode } from '../helpers/bits.js';
import { mulberry32 } from '../helpers/generate.js';

function randomBytes(length: number, seed: number): Uint8Array {
  const random = mulberry32(seed);
  return Uint8Array.from({ length }, () => Math.floor(random() * 256));
}

/** Evaluates a wire-order (descending-degree) block at a field point. */
function evalBlock(block: Uint8Array, x: number): number {
  let acc = 0;
  for (const byte of block) acc = gfMul(acc, x) ^ byte;
  return acc;
}

describe('rsEncode reference encoder (test helper)', () => {
  it('produces blocks that vanish at every generator root', () => {
    const block = rsEncode(randomBytes(30, 11), 18);
    for (let j = 0; j < 18; j++) {
      expect(evalBlock(block, alphaPow(j))).toBe(0);
    }
  });

  it('agrees with the spec example structure: parity extends, never edits, data', () => {
    const data = randomBytes(19, 12);
    const block = rsEncode(data, 7);
    expect(block).toHaveLength(26);
    expect(block.subarray(0, 19)).toEqual(data);
  });
});

describe('rsCorrect (Berlekamp–Massey / Chien / Forney)', () => {
  it('leaves an undamaged block alone and reports zero corrections', () => {
    const block = rsEncode(randomBytes(19, 21), 7);
    const working = block.slice();
    expect(rsCorrect(working, 7)).toBe(0);
    expect(working).toEqual(block);
  });

  it('repairs a single flipped codeword anywhere in the block', () => {
    const block = rsEncode(randomBytes(22, 22), 22);
    for (const index of [0, 1, 21, 22, 43]) {
      const working = block.slice();
      working[index]! ^= 0xa5;
      expect(rsCorrect(working, 22)).toBe(1);
      expect(working).toEqual(block);
    }
  });

  it('repairs every error count up to the ⌊ec/2⌋ capacity', () => {
    const ecCount = 24;
    const block = rsEncode(randomBytes(40, 23), ecCount);
    const random = mulberry32(24);
    for (let errors = 1; errors <= ecCount / 2; errors++) {
      const working = block.slice();
      const positions = new Set<number>();
      while (positions.size < errors) {
        positions.add(Math.floor(random() * working.length));
      }
      for (const pos of positions) {
        working[pos]! ^= 1 + Math.floor(random() * 255);
      }
      expect(rsCorrect(working, ecCount), `${errors} errors`).toBe(errors);
      expect(working, `${errors} errors`).toEqual(block);
    }
  });

  it('repairs damage confined to the parity codewords', () => {
    const block = rsEncode(randomBytes(19, 25), 7);
    const working = block.slice();
    working[19]! ^= 0x0f;
    working[24]! ^= 0x80;
    working[25]! ^= 0x33;
    expect(rsCorrect(working, 7)).toBe(3);
    expect(working).toEqual(block);
  });

  it('handles the smallest QR block shape (version 1-H: 9 data + 17 ec)', () => {
    const block = rsEncode(randomBytes(9, 26), 17);
    const working = block.slice();
    for (const pos of [0, 5, 10, 15, 20, 25, 12, 18]) {
      working[pos]! ^= 0x5a;
    }
    expect(rsCorrect(working, 17)).toBe(8);
    expect(working).toEqual(block);
  });

  it('refuses (or at least never fakes) blocks damaged beyond capacity', () => {
    const ecCount = 10; // corrects at most 5 errors
    const block = rsEncode(randomBytes(16, 27), ecCount);
    const random = mulberry32(28);
    let refused = 0;
    const rounds = 25;
    for (let round = 0; round < rounds; round++) {
      const working = block.slice();
      const positions = new Set<number>();
      while (positions.size < 8) {
        positions.add(Math.floor(random() * working.length));
      }
      for (const pos of positions) {
        working[pos]! ^= 1 + Math.floor(random() * 255);
      }
      try {
        rsCorrect(working, ecCount);
        // Decoding to some *other* nearby codeword is legitimate RS
        // behaviour; silently reconstructing the original from 8 errors
        // would mean the failure detection is broken.
        expect(working).not.toEqual(block);
      } catch (error) {
        expect((error as { code?: string }).code).toBe('reed-solomon');
        refused++;
      }
    }
    expect(refused).toBeGreaterThan(rounds * 0.6);
  });

  it('corrected output always re-satisfies the generator roots', () => {
    const ecCount = 16;
    const block = rsEncode(randomBytes(30, 29), ecCount);
    const random = mulberry32(30);
    const working = block.slice();
    for (let i = 0; i < 6; i++) {
      working[Math.floor(random() * working.length)]! ^= 1 + Math.floor(random() * 255);
    }
    rsCorrect(working, ecCount);
    for (let j = 0; j < ecCount; j++) {
      expect(polyEval(Uint8Array.from(working).reverse(), alphaPow(j))).toBe(0);
    }
  });
});
