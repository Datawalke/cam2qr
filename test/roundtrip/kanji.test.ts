import { describe, expect, it } from 'vitest';
import { decodeMatrix } from '../../src/core/decode-matrix.js';
import { decode } from '../../src/decode.js';
import { generate } from '../helpers/generate.js';
import { renderMatrix } from '../helpers/image.js';

describe('round-trip: kanji mode', () => {
  it('decodes a generator-produced Kanji-mode symbol from a clean matrix', () => {
    const payload = '点茗こんにちは漢字';
    const qr = generate([{ data: payload, mode: 'kanji' }]);
    const result = decodeMatrix(qr.matrix);
    expect(result.text).toBe(payload);
    expect(result.segments[0]!.mode).toBe('kanji');
  });

  it('decodes a rendered Kanji-mode symbol through the full image pipeline', () => {
    const payload = 'カメラでスキャン';
    const qr = generate([{ data: payload, mode: 'kanji' }]);
    const result = decode(renderMatrix(qr.matrix, { scale: 6, margin: 4 }));
    expect(result).not.toBeNull();
    expect(result!.text).toBe(payload);
  });

  it('decodes mixed kanji and byte segments', () => {
    const qr = generate([
      { data: 'QR: ', mode: 'byte' },
      { data: '日本語', mode: 'kanji' },
    ]);
    const result = decodeMatrix(qr.matrix);
    expect(result.text).toBe('QR: 日本語');
  });
});
