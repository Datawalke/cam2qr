import { describe, expect, it } from 'vitest';
import { decode } from '../../src/decode.js';
import { binarize } from '../../src/detect/binarizer.js';
import { findFinderPatterns, selectBestPatterns } from '../../src/detect/finder.js';
import { toGrayscale } from '../../src/detect/grayscale.js';
import type { ErrorCorrectionLevel, ImageDataLike } from '../../src/types.js';
import { generate, mulberry32 } from '../helpers/generate.js';
import {
  addSaltPepperNoise,
  applyIlluminationGradient,
  boxBlur,
  invertImage,
  reduceContrast,
  renderMatrix,
  rotateImage,
  warpImage,
} from '../helpers/image.js';

function renderQr(
  payload: string,
  options: { version?: number; level?: ErrorCorrectionLevel; scale?: number; margin?: number } = {},
): ImageDataLike {
  const qr = generate(payload, {
    ...(options.version !== undefined ? { version: options.version } : {}),
    level: options.level ?? 'M',
  });
  return renderMatrix(qr.matrix, {
    scale: options.scale ?? 6,
    margin: options.margin ?? 4,
  });
}

describe('finder pattern location', () => {
  it('finds the three finder patterns of a clean symbol', () => {
    const image = renderQr('finder test', { version: 2, scale: 8, margin: 4 });
    const bits = binarize(toGrayscale(image));
    const ordered = selectBestPatterns(findFinderPatterns(bits));
    expect(ordered).not.toBeNull();
    const { topLeft, topRight, bottomLeft } = ordered!;
    // Version 2 = 25 modules; margin 4, scale 8 → center of a finder is at
    // (4 + 3.5) modules = 60px from each symbol edge.
    expect(topLeft.x).toBeCloseTo(60, 0);
    expect(topLeft.y).toBeCloseTo(60, 0);
    expect(topRight.x).toBeCloseTo((4 + 25 - 3.5) * 8, 0);
    expect(topRight.y).toBeCloseTo(60, 0);
    expect(bottomLeft.x).toBeCloseTo(60, 0);
    expect(bottomLeft.y).toBeCloseTo((4 + 25 - 3.5) * 8, 0);
    expect(topLeft.moduleSize).toBeCloseTo(8, 0);
  });
});

describe('decode() on rendered images', () => {
  it('decodes clean symbols across versions and scales', () => {
    const cases: Array<[number, ErrorCorrectionLevel, number]> = [
      [1, 'M', 4],
      [2, 'L', 3],
      [3, 'Q', 5],
      [5, 'H', 4],
      [7, 'M', 4],
      [10, 'Q', 3],
      [15, 'M', 3],
      [25, 'L', 3],
      [40, 'M', 3],
    ];
    for (const [version, level, scale] of cases) {
      const payload = `v${version}${level}@${scale}`;
      const result = decode(renderQr(payload, { version, level, scale }));
      expect(result, `v${version}${level} scale ${scale}`).not.toBeNull();
      expect(result!.text).toBe(payload);
      expect(result!.version).toBe(version);
    }
  });

  it('reports sensible corner points and module size', () => {
    const result = decode(renderQr('corners', { version: 1, scale: 6, margin: 4 }));
    expect(result).not.toBeNull();
    const [tl, tr, br, bl] = result!.cornerPoints;
    const edge = 4 * 6; // margin in pixels
    const size = (21 + 8) * 6;
    expect(tl.x).toBeCloseTo(edge, 0);
    expect(tl.y).toBeCloseTo(edge, 0);
    expect(tr.x).toBeCloseTo(size - edge, 0);
    expect(br.y).toBeCloseTo(size - edge, 0);
    expect(bl.x).toBeCloseTo(edge, 0);
    expect(result!.moduleSize).toBeCloseTo(6, 0);
  });

  it('decodes at every 90° orientation', () => {
    const payload = 'orientation test';
    const image = renderQr(payload, { version: 2, scale: 6 });
    for (const quarter of [0, 1, 2, 3]) {
      const rotated = rotateImage(image, (quarter * Math.PI) / 2);
      const result = decode(rotated);
      expect(result, `rotation ${quarter * 90}°`).not.toBeNull();
      expect(result!.text).toBe(payload);
    }
  });

  it('decodes at arbitrary rotation angles', () => {
    const payload = 'skewed but readable';
    const image = renderQr(payload, { version: 3, scale: 8 });
    for (const degrees of [10, 33, 45, 120, 200, 305]) {
      const rotated = rotateImage(image, (degrees * Math.PI) / 180);
      const result = decode(rotated);
      expect(result, `rotation ${degrees}°`).not.toBeNull();
      expect(result!.text).toBe(payload);
    }
  });

  it('decodes under mild perspective distortion', () => {
    const payload = 'keystone distortion';
    const image = renderQr(payload, { version: 4, scale: 8 });
    const s = image.width;
    const warped = warpImage(
      image,
      [
        { x: 30, y: 22 },
        { x: s - 12, y: 38 },
        { x: s - 30, y: s - 25 },
        { x: 14, y: s - 40 },
      ],
      s,
      s,
    );
    const result = decode(warped);
    expect(result).not.toBeNull();
    expect(result!.text).toBe(payload);
  });

  it('decodes with salt & pepper noise (high EC level)', () => {
    const payload = 'noisy channel';
    const image = renderQr(payload, { version: 4, level: 'H', scale: 6 });
    const noisy = addSaltPepperNoise(image, 0.005, mulberry32(1234));
    const result = decode(noisy);
    expect(result).not.toBeNull();
    expect(result!.text).toBe(payload);
  });

  it('decodes under an illumination gradient', () => {
    const payload = 'uneven lighting';
    const image = renderQr(payload, { version: 3, scale: 6 });
    const shaded = applyIlluminationGradient(image, 1, 0.35);
    const result = decode(shaded);
    expect(result).not.toBeNull();
    expect(result!.text).toBe(payload);
  });

  it('decodes low-contrast prints', () => {
    const payload = 'washed out';
    const image = renderQr(payload, { version: 2, scale: 6 });
    const faded = reduceContrast(image, 100, 180);
    const result = decode(faded);
    expect(result).not.toBeNull();
    expect(result!.text).toBe(payload);
  });

  it('decodes mildly blurred images', () => {
    const payload = 'out of focus';
    const image = renderQr(payload, { version: 2, scale: 8 });
    const blurred = boxBlur(image, 2);
    const result = decode(blurred);
    expect(result).not.toBeNull();
    expect(result!.text).toBe(payload);
  });

  it('decodes inverted (light-on-dark) symbols by default', () => {
    const payload = 'dark mode qr';
    const image = invertImage(renderQr(payload, { version: 2, scale: 6 }));
    const result = decode(image);
    expect(result).not.toBeNull();
    expect(result!.text).toBe(payload);
    expect(decode(image, { tryInverted: false })).toBeNull();
  });

  it('tolerates a reduced quiet zone', () => {
    const payload = 'tight margin';
    const result = decode(renderQr(payload, { version: 2, scale: 6, margin: 2 }));
    expect(result).not.toBeNull();
    expect(result!.text).toBe(payload);
  });

  it('returns null when no QR code is present', () => {
    const blank: ImageDataLike = {
      data: new Uint8ClampedArray(200 * 200 * 4).fill(255),
      width: 200,
      height: 200,
    };
    expect(decode(blank)).toBeNull();

    const random = mulberry32(99);
    const noise = addSaltPepperNoise(blank, 0.5, random);
    expect(decode(noise)).toBeNull();
  });

  it('throws on malformed input dimensions', () => {
    expect(() => decode({ data: new Uint8ClampedArray(10), width: 100, height: 100 })).toThrow(
      RangeError,
    );
  });
});
