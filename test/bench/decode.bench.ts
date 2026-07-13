import { bench, describe } from 'vitest';
import { decodeMatrix } from '../../src/core/decode-matrix.js';
import { decode } from '../../src/decode.js';
import { binarize } from '../../src/detect/binarizer.js';
import { detect } from '../../src/detect/detector.js';
import { toGrayscale } from '../../src/detect/grayscale.js';
import { generate } from '../helpers/generate.js';
import { renderMatrix, rotateImage } from '../helpers/image.js';

// Camera-realistic frame: version 2 symbol occupying part of a 640×480-ish
// image (33 modules × 6px = 198px symbol within a 396px frame with margin).
const v2 = generate('https://example.com/bench', { version: 2, level: 'M' });
const frameV2 = renderMatrix(v2.matrix, { scale: 6, margin: 4 });
const frameV2Rotated = rotateImage(frameV2, (30 * Math.PI) / 180);
const v10 = generate('bench payload for a version ten symbol with more data', {
  version: 10,
  level: 'M',
});
const frameV10 = renderMatrix(v10.matrix, { scale: 5, margin: 4 });

const grayV2 = toGrayscale(frameV2);
const bitsV2 = binarize(grayV2);
const matrixV2 = v2.matrix;

// 640×480 noise-free gray backdrop for the no-QR case.
const grayBackdrop = {
  data: new Uint8ClampedArray(640 * 480 * 4).fill(200),
  width: 640,
  height: 480,
};

describe('end-to-end decode()', () => {
  bench('v2 clean frame', () => {
    decode(frameV2);
  });
  bench('v2 rotated 30°', () => {
    decode(frameV2Rotated);
  });
  bench('v10 clean frame', () => {
    decode(frameV10);
  });
  bench('no QR present (worst-case scan loop frame)', () => {
    decode(grayBackdrop);
  });
});

describe('pipeline stages (v2 frame)', () => {
  bench('grayscale', () => {
    toGrayscale(frameV2);
  });
  bench('binarize', () => {
    binarize(grayV2);
  });
  bench('detect', () => {
    detect(bitsV2);
  });
  bench('decodeMatrix', () => {
    decodeMatrix(matrixV2);
  });
});
