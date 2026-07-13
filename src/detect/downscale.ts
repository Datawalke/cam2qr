import type { GrayImage } from './grayscale.js';

/**
 * Integer-factor box downsampling. Besides speeding up huge frames, the
 * averaging acts as a low-pass filter, which often *recovers* blurry or
 * oversampled codes the full-resolution pass misses.
 */
export function downscaleGray(gray: GrayImage, factor: number): GrayImage {
  const width = Math.floor(gray.width / factor);
  const height = Math.floor(gray.height / factor);
  const luma = new Uint8Array(width * height);
  const area = factor * factor;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let sum = 0;
      const srcY = y * factor;
      const srcX = x * factor;
      for (let dy = 0; dy < factor; dy++) {
        const rowOffset = (srcY + dy) * gray.width + srcX;
        for (let dx = 0; dx < factor; dx++) {
          sum += gray.luma[rowOffset + dx]!;
        }
      }
      luma[y * width + x] = sum / area;
    }
  }
  return { luma, width, height };
}
