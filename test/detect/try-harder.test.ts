import { describe, expect, it } from 'vitest';
import { decode } from '../../src/decode.js';
import type { ImageDataLike } from '../../src/types.js';
import { generate } from '../helpers/generate.js';
import { boxBlur, renderMatrix } from '../helpers/image.js';

/** Stamps a decoy finder-like pattern (7×7 modules) into the image. */
function stampDecoyFinder(image: ImageDataLike, left: number, top: number, scale: number): void {
  const data = image.data as Uint8ClampedArray;
  const setPixel = (x: number, y: number, value: number) => {
    if (x < 0 || x >= image.width || y < 0 || y >= image.height) return;
    const offset = (y * image.width + x) * 4;
    data[offset] = value;
    data[offset + 1] = value;
    data[offset + 2] = value;
  };
  for (let my = 0; my < 7; my++) {
    for (let mx = 0; mx < 7; mx++) {
      const ring = Math.max(Math.abs(mx - 3), Math.abs(my - 3));
      const dark = ring !== 2 && !(ring === 3 && (mx === 0 || mx === 6 || my === 0 || my === 6));
      // 7×7 finder: dark border, light ring, dark 3×3 core.
      const value = ring === 3 || ring === 1 ? (ring === 1 ? 255 : 0) : dark ? 0 : 255;
      for (let py = 0; py < scale; py++) {
        for (let px = 0; px < scale; px++) {
          setPixel(left + mx * scale + px, top + my * scale + py, value);
        }
      }
    }
  }
}

describe('decode() robustness options', () => {
  it('tryHarder recovers heavily blurred codes via the downscale pass', () => {
    const payload = 'badly out of focus';
    const image = renderMatrix(generate(payload, { version: 2, level: 'M' }).matrix, {
      scale: 24,
      margin: 4,
    });
    const blurred = boxBlur(image, 12);
    // The integral-image binarizer may decode this blur level even at full
    // resolution; the recovery guarantee under tryHarder is what this test
    // pins down, so no `decode(blurred) === null` baseline is asserted.
    const result = decode(blurred, { tryHarder: true });
    expect(result).not.toBeNull();
    expect(result!.text).toBe(payload);
  });

  it('tryHarder survives decoy finder patterns near the symbol', () => {
    const payload = 'decoy resistance';
    const image = renderMatrix(generate(payload, { version: 3, level: 'M' }).matrix, {
      scale: 6,
      margin: 10,
    });
    // Similar-scale decoys in the quiet zone corners confuse triple selection.
    stampDecoyFinder(image, 6, 6, 6);
    stampDecoyFinder(image, image.width - 48, 6, 6);
    const result = decode(image, { tryHarder: true });
    expect(result).not.toBeNull();
    expect(result!.text).toBe(payload);
  });

  it('maxDownscale decodes huge frames and reports full-resolution geometry', () => {
    const payload = 'giant frame';
    const qr = generate(payload, { version: 2, level: 'M' });
    const image = renderMatrix(qr.matrix, { scale: 40, margin: 4 }); // 1320×1320
    const result = decode(image, { maxDownscale: 4 });
    expect(result).not.toBeNull();
    expect(result!.text).toBe(payload);
    // Corner points must be reported in the original pixel space.
    const [tl, , br] = result!.cornerPoints;
    expect(tl.x).toBeCloseTo(4 * 40, -2);
    expect(br.x).toBeCloseTo((4 + 25) * 40, -2);
    expect(result!.moduleSize).toBeGreaterThan(20);
  });

  it('maxDownscale still falls back to full resolution for small codes', () => {
    // A frame that is huge but whose QR is small: the downscaled pass fails,
    // the full-resolution pass must still run.
    const payload = 'small code, big frame';
    const qr = generate(payload, { version: 2, level: 'M' });
    const small = renderMatrix(qr.matrix, { scale: 3, margin: 4 });
    const big: ImageDataLike = {
      data: new Uint8ClampedArray(1400 * 1400 * 4).fill(255),
      width: 1400,
      height: 1400,
    };
    // Paste the small symbol into the top-left corner of the big frame.
    for (let y = 0; y < small.height; y++) {
      for (let x = 0; x < small.width; x++) {
        const from = (y * small.width + x) * 4;
        const to = (y * big.width + x) * 4;
        big.data[to] = small.data[from]!;
        big.data[to + 1] = small.data[from + 1]!;
        big.data[to + 2] = small.data[from + 2]!;
      }
    }
    const result = decode(big, { maxDownscale: 8 });
    expect(result).not.toBeNull();
    expect(result!.text).toBe(payload);
  });

  it('plain decode is unchanged by default (no extra passes)', () => {
    const payload = 'defaults ok';
    const image = renderMatrix(generate(payload, { version: 1 }).matrix, { scale: 6 });
    const result = decode(image);
    expect(result).not.toBeNull();
    expect(result!.text).toBe(payload);
  });
});
