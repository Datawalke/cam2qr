import { DecodeError } from '../errors.js';
import type { ErrorCorrectionLevel } from '../types.js';
import type { BitMatrix } from './bit-matrix.js';
import { buildFunctionPatternMap } from './function-pattern.js';
import { maskBit } from './mask.js';
import { rsCorrect } from './reed-solomon.js';
import { getVersionInfo } from './version.js';

/**
 * Reads the raw codeword stream out of a sampled symbol (ISO/IEC 18004
 * §8.7.3): modules are visited in two-module-wide column bands, right to
 * left, alternating bottom-up and top-down. The vertical timing column is
 * simply absent from the visit order, function modules are skipped, and each
 * data bit is unmasked as it is read. Remainder bits (fewer than 8 left over)
 * are discarded per the spec.
 */
// #region snippet: zigzag
export function readCodewords(matrix: BitMatrix, version: number, mask: number): Uint8Array {
  const size = matrix.size;
  const functionModules = buildFunctionPatternMap(version);

  // Column x-coordinates in visit order: right to left, without the vertical
  // timing column at x = 6. The remaining count is even, so consecutive
  // entries pair up into the two-module bands.
  const columns: number[] = [];
  for (let x = size - 1; x >= 0; x--) {
    if (x !== 6) columns.push(x);
  }

  const bytes: number[] = [];
  let acc = 0;
  let bitCount = 0;
  const visit = (x: number, y: number): void => {
    if (functionModules.get(x, y)) return;
    const bit = matrix.get(x, y) !== maskBit(mask, y, x);
    acc = (acc << 1) | (bit ? 1 : 0);
    if (++bitCount === 8) {
      bytes.push(acc);
      acc = 0;
      bitCount = 0;
    }
  };

  for (let band = 0; band < columns.length; band += 2) {
    const rightX = columns[band]!;
    const leftX = columns[band + 1]!;
    const upward = (band & 2) === 0;
    for (let step = 0; step < size; step++) {
      const y = upward ? size - 1 - step : step;
      visit(rightX, y);
      visit(leftX, y);
    }
  }
  return Uint8Array.from(bytes);
}
// #endregion snippet

/**
 * Undoes the block interleaving of §8.6, error-corrects each block, and
 * concatenates the data codewords. Block shapes come straight from the
 * version's EC table: an array of per-block data lengths (all blocks share
 * one EC length), indexed round-robin — no special casing of short vs long
 * blocks.
 */
export function correctAndExtractData(
  raw: Uint8Array,
  version: number,
  level: ErrorCorrectionLevel,
): { bytes: Uint8Array; blocks: number; codewordsCorrected: number } {
  const { ecCodewordsPerBlock, groups } = getVersionInfo(version).ecBlocks[level];

  const dataLengths: number[] = [];
  for (const group of groups) {
    for (let i = 0; i < group.count; i++) dataLengths.push(group.dataCodewords);
  }
  const blockCount = dataLengths.length;
  const totalData = dataLengths.reduce((sum, len) => sum + len, 0);
  const totalCodewords = totalData + blockCount * ecCodewordsPerBlock;
  if (raw.length !== totalCodewords) {
    throw new DecodeError(
      'codewords',
      `read ${raw.length} codewords, version ${version}${level} carries ${totalCodewords}`,
    );
  }

  // Interleaving sends codeword i of every block before codeword i+1 of any;
  // blocks whose data section has already ended just sit a round out. EC
  // codewords follow the same rotation after all data.
  const blocks = dataLengths.map((len) => new Uint8Array(len + ecCodewordsPerBlock));
  let cursor = 0;
  const longestData = Math.max(...dataLengths);
  for (let round = 0; round < longestData; round++) {
    for (let b = 0; b < blockCount; b++) {
      if (round < dataLengths[b]!) blocks[b]![round] = raw[cursor++]!;
    }
  }
  for (let round = 0; round < ecCodewordsPerBlock; round++) {
    for (let b = 0; b < blockCount; b++) {
      blocks[b]![dataLengths[b]! + round] = raw[cursor++]!;
    }
  }

  const bytes = new Uint8Array(totalData);
  let codewordsCorrected = 0;
  let offset = 0;
  for (let b = 0; b < blockCount; b++) {
    codewordsCorrected += rsCorrect(blocks[b]!, ecCodewordsPerBlock);
    bytes.set(blocks[b]!.subarray(0, dataLengths[b]!), offset);
    offset += dataLengths[b]!;
  }
  return { bytes, blocks: blockCount, codewordsCorrected };
}
