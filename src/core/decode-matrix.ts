import { DecodeError } from '../errors.js';
import type { DecodedMatrix } from '../types.js';
import type { BitMatrix } from './bit-matrix.js';
import { correctAndExtractData, readCodewords } from './codewords.js';
import { readFormatInformation } from './format.js';
import { decodeSegments } from './segments.js';
import { versionForSize } from './version.js';

/**
 * Decodes a sampled QR bit matrix (true = dark module) into its payload.
 * This is the pure logical half of the scanner: detection/sampling from an
 * image happens upstream and produces the BitMatrix consumed here.
 */
export function decodeMatrix(matrix: BitMatrix): DecodedMatrix {
  const version = versionForSize(matrix.size);
  if (version === null) {
    throw new DecodeError('invalid-dimension', `invalid QR matrix size ${matrix.size}`);
  }

  const { errorCorrectionLevel, mask } = readFormatInformation(matrix);
  const rawCodewords = readCodewords(matrix, version, mask);
  const {
    bytes: data,
    blocks,
    codewordsCorrected,
  } = correctAndExtractData(rawCodewords, version, errorCorrectionLevel);
  const stream = decodeSegments(data, version);

  const result: DecodedMatrix = {
    text: stream.text,
    bytes: stream.bytes,
    version,
    errorCorrectionLevel,
    mask,
    segments: stream.segments,
    ecc: { blocks, codewordsCorrected },
  };
  if (stream.structuredAppend !== undefined) result.structuredAppend = stream.structuredAppend;
  if (stream.fnc1 !== undefined) result.fnc1 = stream.fnc1;
  return result;
}
