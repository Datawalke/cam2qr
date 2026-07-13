import { describe, expect, it } from 'vitest';
import { countDataModules } from '../../src/core/function-pattern.js';
import {
  getVersionInfo,
  sizeForVersion,
  totalCodewords,
  versionForSize,
} from '../../src/core/version.js';
import type { ErrorCorrectionLevel } from '../../src/types.js';

const LEVELS: ErrorCorrectionLevel[] = ['L', 'M', 'Q', 'H'];

describe('version tables', () => {
  it('maps sizes to versions and back', () => {
    expect(versionForSize(21)).toBe(1);
    expect(versionForSize(177)).toBe(40);
    expect(versionForSize(20)).toBeNull();
    expect(versionForSize(22)).toBeNull();
    expect(versionForSize(181)).toBeNull();
    for (let v = 1; v <= 40; v++) {
      expect(versionForSize(sizeForVersion(v))).toBe(v);
    }
  });

  it('EC table totals are level-independent per version', () => {
    for (let v = 1; v <= 40; v++) {
      const info = getVersionInfo(v);
      const totals = LEVELS.map((level) => totalCodewords(info, level));
      expect(new Set(totals).size).toBe(1);
    }
  });

  it('EC table totals match the module capacity from the function-pattern map', () => {
    // Independent cross-check: the function-pattern map (finders, timing,
    // alignment, format/version areas) determines how many modules the
    // zigzag readout visits; ⌊bits/8⌋ must equal the EC table's codeword
    // total. A wrong alignment coordinate or EC row breaks this.
    for (let v = 1; v <= 40; v++) {
      const info = getVersionInfo(v);
      expect(Math.floor(countDataModules(v) / 8)).toBe(totalCodewords(info, 'L'));
    }
  });

  it('alignment positions are well-formed', () => {
    expect(getVersionInfo(1).alignmentPositions).toEqual([]);
    for (let v = 2; v <= 40; v++) {
      const { alignmentPositions, size } = getVersionInfo(v);
      expect(alignmentPositions.length).toBe(Math.floor(v / 7) + 2);
      expect(alignmentPositions[0]).toBe(6);
      expect(alignmentPositions[alignmentPositions.length - 1]).toBe(size - 7);
    }
  });

  it('rejects out-of-range versions', () => {
    expect(() => getVersionInfo(0)).toThrow(RangeError);
    expect(() => getVersionInfo(41)).toThrow(RangeError);
  });
});
