import type { BitMatrix } from '../../src/core/bit-matrix.js';
import type { ImageDataLike, Point } from '../../src/types.js';

export interface RenderOptions {
  /** Pixels per module. */
  scale?: number;
  /** Quiet zone width in modules. */
  margin?: number;
  dark?: number;
  light?: number;
}

/** Rasterizes a QR bit matrix to an RGBA image (grayscale values). */
export function renderMatrix(matrix: BitMatrix, options: RenderOptions = {}): ImageDataLike {
  const { scale = 6, margin = 4, dark = 0, light = 255 } = options;
  const size = (matrix.size + 2 * margin) * scale;
  const data = new Uint8ClampedArray(size * size * 4);
  for (let y = 0; y < size; y++) {
    const moduleY = Math.floor(y / scale) - margin;
    for (let x = 0; x < size; x++) {
      const moduleX = Math.floor(x / scale) - margin;
      const inSymbol =
        moduleX >= 0 && moduleX < matrix.size && moduleY >= 0 && moduleY < matrix.size;
      const value = inSymbol && matrix.get(moduleX, moduleY) ? dark : light;
      const offset = (y * size + x) * 4;
      data[offset] = value;
      data[offset + 1] = value;
      data[offset + 2] = value;
      data[offset + 3] = 255;
    }
  }
  return { data, width: size, height: size };
}

/** Places images side by side on a white canvas, vertically centered. */
export function composeHorizontal(images: ImageDataLike[], gap = 24): ImageDataLike {
  const width = images.reduce((sum, image) => sum + image.width, 0) + gap * (images.length + 1);
  const height = Math.max(...images.map((image) => image.height)) + gap * 2;
  const data = new Uint8ClampedArray(width * height * 4).fill(255);
  let offsetX = gap;
  for (const image of images) {
    const offsetY = Math.floor((height - image.height) / 2);
    for (let y = 0; y < image.height; y++) {
      for (let x = 0; x < image.width; x++) {
        const src = (y * image.width + x) * 4;
        const dst = ((y + offsetY) * width + (x + offsetX)) * 4;
        data[dst] = image.data[src]!;
        data[dst + 1] = image.data[src + 1]!;
        data[dst + 2] = image.data[src + 2]!;
      }
    }
    offsetX += image.width + gap;
  }
  return { data, width, height };
}

function samplePixel(image: ImageDataLike, x: number, y: number, fallback: number): number {
  const px = Math.round(x);
  const py = Math.round(y);
  if (px < 0 || px >= image.width || py < 0 || py >= image.height) return fallback;
  return image.data[(py * image.width + px) * 4]!;
}

function grayToImage(
  gray: Float64Array | Uint8ClampedArray,
  width: number,
  height: number,
): ImageDataLike {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    const value = gray[i]!;
    data[i * 4] = value;
    data[i * 4 + 1] = value;
    data[i * 4 + 2] = value;
    data[i * 4 + 3] = 255;
  }
  return { data, width, height };
}

/** Rotates around the image center; output bounds fit the rotated image. */
export function rotateImage(
  image: ImageDataLike,
  radians: number,
  background = 255,
): ImageDataLike {
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  const outWidth = Math.ceil(Math.abs(image.width * cos) + Math.abs(image.height * sin));
  const outHeight = Math.ceil(Math.abs(image.width * sin) + Math.abs(image.height * cos));
  const gray = new Uint8ClampedArray(outWidth * outHeight);
  const cxIn = image.width / 2;
  const cyIn = image.height / 2;
  const cxOut = outWidth / 2;
  const cyOut = outHeight / 2;
  for (let y = 0; y < outHeight; y++) {
    for (let x = 0; x < outWidth; x++) {
      // Inverse mapping: rotate the output pixel back into source space.
      const dx = x + 0.5 - cxOut;
      const dy = y + 0.5 - cyOut;
      const sx = cos * dx + sin * dy + cxIn - 0.5;
      const sy = -sin * dx + cos * dy + cyIn - 0.5;
      gray[y * outWidth + x] = samplePixel(image, sx, sy, background);
    }
  }
  return grayToImage(gray, outWidth, outHeight);
}

/**
 * Projects the full source image onto the destination quadrilateral
 * (corners ordered top-left, top-right, bottom-right, bottom-left) inside a
 * `width`×`height` canvas.
 */
export function warpImage(
  image: ImageDataLike,
  corners: [Point, Point, Point, Point],
  width: number,
  height: number,
  background = 255,
): ImageDataLike {
  const project = projectionFromQuads(corners, [
    { x: 0, y: 0 },
    { x: image.width, y: 0 },
    { x: image.width, y: image.height },
    { x: 0, y: image.height },
  ]);
  const gray = new Uint8ClampedArray(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const source = project(x + 0.5, y + 0.5);
      gray[y * width + x] = samplePixel(image, source.x - 0.5, source.y - 0.5, background);
    }
  }
  return grayToImage(gray, width, height);
}

/**
 * Test-local projective mapping, deliberately independent of the library's
 * detect/perspective module so the renderer does not share code with the
 * detector under test. Solves the eight corner-correspondence equations for
 * the 3×3 matrix (last entry pinned to 1) by Gauss–Jordan elimination.
 */
function projectionFromQuads(
  from: readonly Point[],
  to: readonly Point[],
): (x: number, y: number) => Point {
  // Augmented 8×9 system in [m0..m7]; per corner:
  //   x·m0 + y·m1 + m2 − u·x·m6 − u·y·m7 = u
  //   x·m3 + y·m4 + m5 − v·x·m6 − v·y·m7 = v
  const system: number[][] = [];
  for (let i = 0; i < 4; i++) {
    const { x, y } = from[i]!;
    const { x: u, y: v } = to[i]!;
    system.push([x, y, 1, 0, 0, 0, -u * x, -u * y, u]);
    system.push([0, 0, 0, x, y, 1, -v * x, -v * y, v]);
  }
  // Gauss–Jordan: reduce all the way to the identity, no back-substitution.
  for (let col = 0; col < 8; col++) {
    let pivot = col;
    for (let r = col + 1; r < 8; r++) {
      if (Math.abs(system[r]![col]!) > Math.abs(system[pivot]![col]!)) pivot = r;
    }
    if (system[pivot]![col] === 0) throw new Error('degenerate warp quadrilateral');
    [system[col], system[pivot]] = [system[pivot]!, system[col]!];
    const lead = system[col]!;
    const pivotValue = lead[col]!;
    for (let c = col; c < 9; c++) lead[c] = lead[c]! / pivotValue;
    for (let r = 0; r < 8; r++) {
      if (r === col) continue;
      const factor = system[r]![col]!;
      if (factor === 0) continue;
      for (let c = col; c < 9; c++) system[r]![c]! -= factor * lead[c]!;
    }
  }
  const m = system.map((row) => row[8]!);
  return (x, y) => {
    const w = m[6]! * x + m[7]! * y + 1;
    return {
      x: (m[0]! * x + m[1]! * y + m[2]!) / w,
      y: (m[3]! * x + m[4]! * y + m[5]!) / w,
    };
  };
}

/** Flips a fraction of pixels to pure black/white (salt & pepper noise). */
export function addSaltPepperNoise(
  image: ImageDataLike,
  fraction: number,
  random: () => number,
): ImageDataLike {
  const data = Uint8ClampedArray.from(image.data);
  const pixels = image.width * image.height;
  const flips = Math.floor(pixels * fraction);
  for (let i = 0; i < flips; i++) {
    const pixel = Math.floor(random() * pixels);
    const value = random() < 0.5 ? 0 : 255;
    data[pixel * 4] = value;
    data[pixel * 4 + 1] = value;
    data[pixel * 4 + 2] = value;
  }
  return { data, width: image.width, height: image.height };
}

/** Multiplies luminance by a factor ramping from `from` to `to` across x. */
export function applyIlluminationGradient(
  image: ImageDataLike,
  from: number,
  to: number,
): ImageDataLike {
  const data = Uint8ClampedArray.from(image.data);
  for (let y = 0; y < image.height; y++) {
    for (let x = 0; x < image.width; x++) {
      const factor = from + ((to - from) * x) / image.width;
      const offset = (y * image.width + x) * 4;
      data[offset] = data[offset]! * factor;
      data[offset + 1] = data[offset + 1]! * factor;
      data[offset + 2] = data[offset + 2]! * factor;
    }
  }
  return { data, width: image.width, height: image.height };
}

/** Compresses the luminance range: black → low, white → high. */
export function reduceContrast(image: ImageDataLike, low: number, high: number): ImageDataLike {
  const data = Uint8ClampedArray.from(image.data);
  for (let i = 0; i < data.length; i += 4) {
    for (let channel = 0; channel < 3; channel++) {
      data[i + channel] = low + (data[i + channel]! / 255) * (high - low);
    }
  }
  return { data, width: image.width, height: image.height };
}

/** Simple box blur with the given radius. */
export function boxBlur(image: ImageDataLike, radius: number): ImageDataLike {
  const { width, height } = image;
  const out = new Uint8ClampedArray(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let sum = 0;
      let count = 0;
      for (let dy = -radius; dy <= radius; dy++) {
        const sy = y + dy;
        if (sy < 0 || sy >= height) continue;
        for (let dx = -radius; dx <= radius; dx++) {
          const sx = x + dx;
          if (sx < 0 || sx >= width) continue;
          sum += image.data[(sy * width + sx) * 4]!;
          count++;
        }
      }
      out[y * width + x] = sum / count;
    }
  }
  return grayToImage(out, width, height);
}

/** Inverts the image: dark modules become light and vice versa. */
export function invertImage(image: ImageDataLike): ImageDataLike {
  const data = Uint8ClampedArray.from(image.data);
  for (let i = 0; i < data.length; i += 4) {
    data[i] = 255 - data[i]!;
    data[i + 1] = 255 - data[i + 1]!;
    data[i + 2] = 255 - data[i + 2]!;
  }
  return { data, width: image.width, height: image.height };
}
