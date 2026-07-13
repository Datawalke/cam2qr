import { DecodeError } from '../errors.js';
import type { ErrorCorrectionLevel } from '../types.js';
import { decodeFormatBits, decodeVersionBits } from './bch.js';
import type { BitMatrix } from './bit-matrix.js';

export interface FormatInformation {
  errorCorrectionLevel: ErrorCorrectionLevel;
  mask: number;
}

// Format field EC bits (ISO/IEC 18004 §8.9): L=01, M=00, Q=11, H=10.
const EC_LEVELS: ErrorCorrectionLevel[] = ['M', 'L', 'H', 'Q'];

// #region snippet: format-info
/**
 * Reads and decodes the format information from its two redundant placements
 * jointly, correcting up to 3 bit errors in the better-preserved copy — a
 * copy damaged toward a different valid codeword cannot shadow a clean one.
 */
export function readFormatInformation(matrix: BitMatrix): FormatInformation {
  const size = matrix.size;
  const bit = (x: number, y: number) => (matrix.get(x, y) ? 1 : 0);

  // Copy 1: around the top-left finder pattern, MSB first.
  let bits1 = 0;
  for (let x = 0; x <= 5; x++) bits1 = (bits1 << 1) | bit(x, 8);
  bits1 = (bits1 << 1) | bit(7, 8);
  bits1 = (bits1 << 1) | bit(8, 8);
  bits1 = (bits1 << 1) | bit(8, 7);
  for (let y = 5; y >= 0; y--) bits1 = (bits1 << 1) | bit(8, y);

  // Copy 2: split between below the top-right finder and right of the
  // bottom-left finder.
  let bits2 = 0;
  for (let y = size - 1; y >= size - 7; y--) bits2 = (bits2 << 1) | bit(8, y);
  for (let x = size - 8; x < size; x++) bits2 = (bits2 << 1) | bit(x, 8);

  const data = decodeFormatBits(bits1, bits2);
  if (data === null) {
    throw new DecodeError('format-info', 'format information is unreadable');
  }
  return {
    errorCorrectionLevel: EC_LEVELS[(data >> 3) & 0b11]!,
    mask: data & 0b111,
  };
}
// #endregion snippet

/**
 * Reads and decodes the version information blocks (versions 7+) jointly,
 * correcting up to 3 bit errors in the better-preserved copy. Returns null
 * when both copies are unreadable.
 */
export function readVersionInformation(matrix: BitMatrix): number | null {
  const size = matrix.size;
  const bit = (x: number, y: number) => (matrix.get(x, y) ? 1 : 0);

  // Both 6×3 blocks store bit 0 (LSB) first in placement order; read them
  // back MSB-first by walking the block in reverse.
  let bits1 = 0; // bottom-left block: columns 0..5, rows size-11..size-9
  for (let x = 5; x >= 0; x--) {
    for (let y = size - 9; y >= size - 11; y--) bits1 = (bits1 << 1) | bit(x, y);
  }
  let bits2 = 0; // top-right block: transposed layout of the first
  for (let y = 5; y >= 0; y--) {
    for (let x = size - 9; x >= size - 11; x--) bits2 = (bits2 << 1) | bit(x, y);
  }

  return decodeVersionBits(bits1, bits2);
}
