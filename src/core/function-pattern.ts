import { BitMatrix } from './bit-matrix.js';
import { getVersionInfo } from './version.js';

/**
 * Builds a matrix marking every function module (finder patterns, separators,
 * timing patterns, alignment patterns, format/version info areas, dark
 * module) so the codeword readout can skip them.
 */
export function buildFunctionPatternMap(version: number): BitMatrix {
  const info = getVersionInfo(version);
  const size = info.size;
  const map = new BitMatrix(size);

  // Finder patterns + separators + format info areas (the dark module at
  // (8, size-8) falls inside the bottom-left region).
  map.setRegion(0, 0, 9, 9);
  map.setRegion(size - 8, 0, 8, 9);
  map.setRegion(0, size - 8, 9, 8);

  // Alignment patterns: all coordinate pairs except the three that would
  // overlap the finder patterns.
  const positions = info.alignmentPositions;
  const max = positions.length - 1;
  for (let i = 0; i < positions.length; i++) {
    for (let j = 0; j < positions.length; j++) {
      const overlapsFinder =
        (i === 0 && j === 0) || (i === 0 && j === max) || (i === max && j === 0);
      if (overlapsFinder) continue;
      map.setRegion(positions[j]! - 2, positions[i]! - 2, 5, 5);
    }
  }

  // Timing patterns.
  map.setRegion(6, 9, 1, size - 17);
  map.setRegion(9, 6, size - 17, 1);

  // Version info areas (versions 7 and up).
  if (version >= 7) {
    map.setRegion(size - 11, 0, 3, 6);
    map.setRegion(0, size - 11, 6, 3);
  }

  return map;
}

/** Number of non-function modules — the data+EC capacity in bits. */
export function countDataModules(version: number): number {
  const map = buildFunctionPatternMap(version);
  let count = 0;
  for (let y = 0; y < map.size; y++) {
    for (let x = 0; x < map.size; x++) {
      if (!map.get(x, y)) count++;
    }
  }
  return count;
}
