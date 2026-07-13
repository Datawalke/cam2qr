import { describe, expect, it } from 'vitest';
import { decodeVersionBits, encodeVersionInfo } from '../../src/core/bch.js';
import type { BitMatrix } from '../../src/core/bit-matrix.js';
import { readVersionInformation } from '../../src/core/format.js';
import { decode } from '../../src/decode.js';
import { generate } from '../helpers/generate.js';
import { renderMatrix } from '../helpers/image.js';

/** Writes both version-information blocks, mirroring readVersionInformation. */
function writeVersionBlocks(matrix: BitMatrix, bits: number): void {
  const size = matrix.size;
  let i = 17;
  for (let x = 5; x >= 0; x--) {
    for (let y = size - 9; y >= size - 11; y--) {
      matrix.set(x, y, ((bits >> i) & 1) === 1);
      i--;
    }
  }
  i = 17;
  for (let y = 5; y >= 0; y--) {
    for (let x = size - 9; x >= size - 11; x--) {
      matrix.set(x, y, ((bits >> i) & 1) === 1);
      i--;
    }
  }
}

describe('detector version-information gate (versions 7+)', () => {
  it('block writer mirrors the reader', () => {
    const qr = generate('writer check', { version: 7, level: 'M' });
    writeVersionBlocks(qr.matrix, encodeVersionInfo(12));
    expect(readVersionInformation(qr.matrix)).toBe(12);
  });

  it('rejects a symbol whose declared version contradicts its dimension', () => {
    const payload = 'version mismatch';
    const qr = generate(payload, { version: 7, level: 'M' });
    // Control: the untouched symbol decodes as version 7.
    expect(decode(renderMatrix(qr.matrix))?.version).toBe(7);
    // A 45-module grid legibly declaring version 8 is malformed; sampling it
    // as version 7 must not be reported as a successful decode.
    const lying = qr.matrix.clone();
    writeVersionBlocks(lying, encodeVersionInfo(8));
    expect(decode(renderMatrix(lying))).toBeNull();
  });

  it('falls back to the geometric estimate when the blocks are unreadable', () => {
    const payload = 'unreadable version info';
    const qr = generate(payload, { version: 7, level: 'M' });
    const damaged = qr.matrix.clone();
    // Garbage that neither copy decodes (≥4 bit errors from every codeword);
    // the version blocks are function modules, so the data is untouched.
    let garbage = 0;
    while (decodeVersionBits(garbage, garbage) !== null) garbage++;
    writeVersionBlocks(damaged, garbage);
    const result = decode(renderMatrix(damaged));
    expect(result).not.toBeNull();
    expect(result!.text).toBe(payload);
    expect(result!.version).toBe(7);
  });
});
