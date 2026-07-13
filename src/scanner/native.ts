import { parseContent } from '../content/parse.js';
import type { FrameScan, ScanFrameOptions } from '../decode.js';
import type { Detection, ImageDataLike, Point, QrResult } from '../types.js';
import type { DecodeRunner } from './runner.js';

/** Minimal structural view of the Shape Detection API. */
interface DetectedBarcode {
  rawValue: string;
  cornerPoints: Point[];
}
interface BarcodeDetectorLike {
  detect(source: unknown): Promise<DetectedBarcode[]>;
}
type BarcodeDetectorCtor = new (options: { formats: string[] }) => BarcodeDetectorLike;

/**
 * Opt-in fast path over the browser's BarcodeDetector. Returns null when the
 * API is missing; if detection fails at runtime (e.g. Chromium builds without
 * a shape-detection backend), the runner permanently hands over to `fallback`
 * — our own engine — so a scanner started with useNativeDetector never stops
 * decoding.
 *
 * Native results carry text/bytes/cornerPoints/content only. Codec metadata
 * the API does not expose uses placeholders: version 0, mask -1, zero ecc
 * counts, EC level 'M', a single synthetic byte segment, and a moduleSize
 * estimated from the outline.
 */
export function tryCreateNativeRunner(fallback: () => DecodeRunner): DecodeRunner | null {
  const Ctor = (globalThis as { BarcodeDetector?: BarcodeDetectorCtor }).BarcodeDetector;
  if (typeof Ctor !== 'function') return null;
  let detector: BarcodeDetectorLike;
  try {
    detector = new Ctor({ formats: ['qr_code'] });
  } catch {
    return null;
  }

  let fallbackRunner: DecodeRunner | null = null;
  return {
    async scan(image: ImageDataLike, options: ScanFrameOptions): Promise<FrameScan> {
      if (fallbackRunner) return fallbackRunner.scan(image, options);
      try {
        const detected = await detector.detect(toImageData(image));
        return toFrameScan(detected, options);
      } catch {
        fallbackRunner = fallback();
        return fallbackRunner.scan(image, options);
      }
    },
    destroy(): void {
      fallbackRunner?.destroy();
    },
  };
}

function toImageData(image: ImageDataLike): ImageData {
  const data =
    image.data instanceof Uint8ClampedArray ? image.data : new Uint8ClampedArray(image.data);
  // Frame buffers are never SharedArrayBuffer-backed here; satisfy the
  // ArrayBuffer-only ImageData constructor signature.
  return new ImageData(data as Uint8ClampedArray<ArrayBuffer>, image.width, image.height);
}

function toFrameScan(detected: DetectedBarcode[], options: ScanFrameOptions): FrameScan {
  const detections: Detection[] = [];
  const results: QrResult[] = [];
  const limit = options.multiple === true ? detected.length : Math.min(detected.length, 1);

  for (const barcode of detected) {
    const cornerPoints = normalizeCorners(barcode.cornerPoints);
    if (!cornerPoints) continue;
    const moduleSize = estimateModuleSize(cornerPoints);
    detections.push({ cornerPoints, moduleSize });
    if (results.length >= limit) continue;

    const bytes = new TextEncoder().encode(barcode.rawValue);
    const result: QrResult = {
      text: barcode.rawValue,
      bytes,
      cornerPoints,
      moduleSize,
      version: 0,
      errorCorrectionLevel: 'M',
      mask: -1,
      segments: [{ mode: 'byte', bytes, text: barcode.rawValue }],
      ecc: { blocks: 0, codewordsCorrected: 0 },
    };
    if (options.parseContent !== false) result.content = parseContent(result.text);
    results.push(result);
  }
  return { results, detections };
}

function normalizeCorners(points: Point[]): [Point, Point, Point, Point] | null {
  if (points.length !== 4) return null;
  return [
    { x: points[0]!.x, y: points[0]!.y },
    { x: points[1]!.x, y: points[1]!.y },
    { x: points[2]!.x, y: points[2]!.y },
    { x: points[3]!.x, y: points[3]!.y },
  ];
}

/** Rough estimate assuming a mid-size symbol; good enough for overlay scale. */
function estimateModuleSize(corners: [Point, Point, Point, Point]): number {
  const top = Math.hypot(corners[1].x - corners[0].x, corners[1].y - corners[0].y);
  const left = Math.hypot(corners[3].x - corners[0].x, corners[3].y - corners[0].y);
  return (top + left) / 2 / 25;
}
