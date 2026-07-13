import type { ImageDataLike } from '../types.js';

export interface GrayImage {
  luma: Uint8Array;
  width: number;
  height: number;
}

// #region snippet: grayscale
/**
 * RGBA → luminance using integer BT.601 weights
 * (0.299 R + 0.587 G + 0.114 B), the standard for barcode luminance sources.
 */
export function toGrayscale(image: ImageDataLike): GrayImage {
  const { data, width, height } = image;
  if (data.length < width * height * 4) {
    throw new RangeError('image data too short for RGBA dimensions');
  }
  const luma = new Uint8Array(width * height);
  for (let i = 0, p = 0; i < luma.length; i++, p += 4) {
    luma[i] = (77 * data[p]! + 150 * data[p + 1]! + 29 * data[p + 2]!) >> 8;
  }
  return { luma, width, height };
}
// #endregion snippet
