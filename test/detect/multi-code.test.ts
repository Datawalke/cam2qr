import { describe, expect, it } from 'vitest';
import { decode, decodeAll, detect } from '../../src/decode.js';
import type { ImageDataLike, Point } from '../../src/types.js';
import { generate } from '../helpers/generate.js';
import { composeHorizontal, invertImage, renderMatrix } from '../helpers/image.js';

function qrImage(payload: string, scale = 6): ImageDataLike {
  return renderMatrix(generate(payload, { version: 2, level: 'M' }).matrix, { scale, margin: 4 });
}

function blankImage(width = 200, height = 200): ImageDataLike {
  return { data: new Uint8ClampedArray(width * height * 4).fill(255), width, height };
}

function centerX(cornerPoints: readonly Point[]): number {
  return cornerPoints.reduce((sum, point) => sum + point.x, 0) / cornerPoints.length;
}

describe('decodeAll', () => {
  it('decodes two codes in one frame with disjoint geometry', () => {
    const image = composeHorizontal([qrImage('left payload'), qrImage('right payload')]);
    const results = decodeAll(image);
    expect(results.map((r) => r.text).sort()).toEqual(['left payload', 'right payload']);

    const left = results.find((r) => r.text === 'left payload')!;
    const right = results.find((r) => r.text === 'right payload')!;
    expect(centerX(left.cornerPoints)).toBeLessThan(centerX(right.cornerPoints));
    expect(left.content?.type).toBe('text');
  });

  it('agrees with decode() on a single-code frame', () => {
    const image = qrImage('only one');
    const results = decodeAll(image);
    expect(results).toHaveLength(1);
    expect(results[0]!.text).toBe(decode(image)!.text);
  });

  it('merges the inverted pass: finds a normal and an inverted code together', () => {
    const image = composeHorizontal([
      qrImage('dark on light'),
      invertImage(qrImage('light on dark')),
    ]);
    const results = decodeAll(image);
    expect(results.map((r) => r.text).sort()).toEqual(['dark on light', 'light on dark']);
  });

  it('does not duplicate a code found in both the downscaled and full pass', () => {
    // 33 modules × 32 px = 1056 px — past the auto-downscale threshold.
    const image = qrImage('big frame', 32);
    const results = decodeAll(image, { maxDownscale: 2 });
    expect(results.map((r) => r.text)).toEqual(['big frame']);
  });

  it('returns an empty array for a frame without codes', () => {
    expect(decodeAll(blankImage())).toEqual([]);
  });
});

describe('detect', () => {
  it('locates candidates without decoding, matching decode geometry', () => {
    const image = qrImage('locate me');
    const detections = detect(image);
    expect(detections.length).toBeGreaterThanOrEqual(1);
    const decoded = decode(image)!;
    expect(centerX(detections[0]!.cornerPoints)).toBeCloseTo(centerX(decoded.cornerPoints), 0);
    expect(detections[0]!.moduleSize).toBeCloseTo(decoded.moduleSize, 1);
  });

  it('reports each symbol in a multi-code frame once', () => {
    const image = composeHorizontal([qrImage('one'), qrImage('two')]);
    const detections = detect(image);
    expect(detections).toHaveLength(2);
    const centers = detections.map((d) => centerX(d.cornerPoints)).sort((a, b) => a - b);
    expect(centers[1]! - centers[0]!).toBeGreaterThan(100);
  });

  it('respects maxCandidates', () => {
    const image = composeHorizontal([qrImage('one'), qrImage('two')]);
    expect(detect(image, { maxCandidates: 1 })).toHaveLength(1);
  });

  it('returns an empty array when nothing looks like a QR code', () => {
    expect(detect(blankImage())).toEqual([]);
  });
});
