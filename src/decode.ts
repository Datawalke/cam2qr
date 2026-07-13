import { parseContent } from './content/parse.js';
import { decodeMatrix } from './core/decode-matrix.js';
import { binarize } from './detect/binarizer.js';
import type { BitImage } from './detect/bit-image.js';
import { iterateDetections } from './detect/detector.js';
import { downscaleGray } from './detect/downscale.js';
import type { FinderPattern } from './detect/finder.js';
import { type GrayImage, toGrayscale } from './detect/grayscale.js';
import { DecodeError } from './errors.js';
import type {
  DecodeImageOptions,
  DetectImageOptions,
  Detection,
  ImageDataLike,
  Point,
  QrResult,
} from './types.js';

/** Frames larger than this (longest side) get an automatic downscale pass. */
const AUTO_DOWNSCALE_THRESHOLD = 1000;
const MIN_DECODABLE_SIZE = 21;
/** Finder-triple budget per pass when hunting for every symbol in the frame. */
const MULTI_TRIPLE_LIMIT = 16;
const DEFAULT_MAX_DETECTIONS = 8;

/** Options for scanning one frame; the superset the scanner loop uses. */
export interface ScanFrameOptions extends DecodeImageOptions {
  /** Decode every symbol in the frame instead of stopping at the first. */
  multiple?: boolean;
}

/** Everything one pipeline run learned about a frame. */
export interface FrameScan {
  results: QrResult[];
  detections: Detection[];
}

/**
 * Finds and decodes a QR code in an RGBA image (e.g. a canvas ImageData).
 * Returns null when no decodable QR code is present; throws only on invalid
 * input (malformed dimensions).
 */
export function decode(image: ImageDataLike, options: DecodeImageOptions = {}): QrResult | null {
  return scanImage(image, options, singleMode(options)).results[0] ?? null;
}

/**
 * Finds and decodes every QR code in the frame. Unlike decode(), this always
 * runs the full pass plan (all scales, plus inverted when enabled) and merges
 * the passes, so it costs roughly what a failing decode() costs even when the
 * frame contains a code.
 */
export function decodeAll(image: ImageDataLike, options: DecodeImageOptions = {}): QrResult[] {
  const mode: ScanMode = {
    decode: true,
    multiple: true,
    maxTriples: MULTI_TRIPLE_LIMIT,
    maxDetections: DEFAULT_MAX_DETECTIONS,
  };
  return scanImage(image, options, mode).results;
}

/**
 * Locates QR symbol candidates without decoding them — corner points and
 * module size only. Cheaper than decode() and useful for live outline
 * overlays and framing feedback; candidates are plausibility-ranked and may
 * include finder-like decoys that would not survive a decode.
 */
export function detect(image: ImageDataLike, options: DetectImageOptions = {}): Detection[] {
  const mode: ScanMode = {
    decode: false,
    multiple: false,
    maxTriples: MULTI_TRIPLE_LIMIT,
    maxDetections: options.maxCandidates ?? 4,
  };
  return scanImage(image, options, mode).detections;
}

/**
 * One scan-loop iteration: decode result(s) plus the symbol candidates seen
 * along the way (populated even when nothing decodes — that is what live
 * overlays track). Scanner/worker entry point; decode()/decodeAll()/detect()
 * are the stable public faces of this.
 */
export function scanFrame(image: ImageDataLike, options: ScanFrameOptions = {}): FrameScan {
  const mode: ScanMode =
    options.multiple === true
      ? {
          decode: true,
          multiple: true,
          maxTriples: MULTI_TRIPLE_LIMIT,
          maxDetections: DEFAULT_MAX_DETECTIONS,
        }
      : singleMode(options);
  return scanImage(image, options, mode);
}

interface ScanMode {
  /** Attempt decodeMatrix on candidates (false = locate only). */
  decode: boolean;
  /** Keep going after the first decoded symbol and merge all passes. */
  multiple: boolean;
  /** Finder-triple budget per binarization pass. */
  maxTriples: number;
  /** Cap on distinct detection candidates reported. */
  maxDetections: number;
}

function singleMode(options: DecodeImageOptions): ScanMode {
  return {
    decode: true,
    multiple: false,
    maxTriples: options.tryHarder === true ? 4 : 1,
    maxDetections: 4,
  };
}

function scanImage(image: ImageDataLike, options: ScanFrameOptions, mode: ScanMode): FrameScan {
  const gray = toGrayscale(image);
  const tryInverted = options.tryInverted !== false;
  const results: QrResult[] = [];
  const detections: Detection[] = [];

  for (const factor of planScales(gray, options)) {
    const scaled = factor === 1 ? gray : downscaleGray(gray, factor);
    const bits = binarize(scaled);
    for (let polarity = 0; polarity < (tryInverted ? 2 : 1); polarity++) {
      scanPass(polarity === 0 ? bits : bits.inverted(), factor, mode, results, detections);
      if (mode.decode && !mode.multiple && results.length > 0) {
        finalize(results, options);
        return { results, detections };
      }
    }
  }
  finalize(results, options);
  return { results, detections };
}

/**
 * Runs detection (and optionally decoding) over one binarized image,
 * appending to the shared result/detection lists. Multi-code partitioning:
 * once a triple decodes, its three finder patterns are consumed and any
 * later triple touching them is skipped, so each physical symbol is decoded
 * at most once per pass. Cross-pass duplicates are filtered by position.
 */
function scanPass(
  bits: BitImage,
  factor: number,
  mode: ScanMode,
  results: QrResult[],
  detections: Detection[],
): void {
  /** Finder patterns of successfully decoded symbols (skip their triples). */
  const consumed = new Set<FinderPattern>();
  /** Finder patterns already represented in the detections list. */
  const listed = new Set<FinderPattern>();

  for (const detection of iterateDetections(bits, mode.maxTriples)) {
    const { topLeft, topRight, bottomLeft } = detection.patterns;
    if (consumed.has(topLeft) || consumed.has(topRight) || consumed.has(bottomLeft)) continue;

    if (
      detections.length < mode.maxDetections &&
      !(listed.has(topLeft) || listed.has(topRight) || listed.has(bottomLeft))
    ) {
      const candidate: Detection = {
        cornerPoints: scaleCorners(detection.cornerPoints, factor),
        moduleSize: detection.moduleSize * factor,
      };
      if (!detections.some((d) => sameLocation(d.cornerPoints, candidate.cornerPoints))) {
        detections.push(candidate);
      }
      listed.add(topLeft);
      listed.add(topRight);
      listed.add(bottomLeft);
    }

    if (!mode.decode) continue;
    let decoded: ReturnType<typeof decodeMatrix>;
    try {
      decoded = decodeMatrix(detection.matrix);
    } catch (error) {
      if (error instanceof DecodeError) continue;
      throw error;
    }
    const result: QrResult = {
      ...decoded,
      cornerPoints: scaleCorners(detection.cornerPoints, factor),
      moduleSize: detection.moduleSize * factor,
    };
    if (
      !results.some(
        (r) => r.text === result.text && sameLocation(r.cornerPoints, result.cornerPoints),
      )
    ) {
      results.push(result);
    }
    consumed.add(topLeft);
    consumed.add(topRight);
    consumed.add(bottomLeft);
    if (!mode.multiple) return;
  }
}

function finalize(results: QrResult[], options: DecodeImageOptions): void {
  if (options.parseContent === false) return;
  for (const result of results) {
    result.content = parseContent(result.text, { gs1: result.fnc1?.position === 'first' });
  }
}

function scaleCorners(
  corners: readonly [Point, Point, Point, Point],
  factor: number,
): [Point, Point, Point, Point] {
  return [
    { x: corners[0].x * factor, y: corners[0].y * factor },
    { x: corners[1].x * factor, y: corners[1].y * factor },
    { x: corners[2].x * factor, y: corners[2].y * factor },
    { x: corners[3].x * factor, y: corners[3].y * factor },
  ];
}

/** Same physical symbol: outline centers closer than half the larger diagonal. */
function sameLocation(a: readonly Point[], b: readonly Point[]): boolean {
  const size = Math.max(
    Math.hypot(a[2]!.x - a[0]!.x, a[2]!.y - a[0]!.y),
    Math.hypot(b[2]!.x - b[0]!.x, b[2]!.y - b[0]!.y),
  );
  const ax = (a[0]!.x + a[1]!.x + a[2]!.x + a[3]!.x) / 4;
  const ay = (a[0]!.y + a[1]!.y + a[2]!.y + a[3]!.y) / 4;
  const bx = (b[0]!.x + b[1]!.x + b[2]!.x + b[3]!.x) / 4;
  const by = (b[0]!.y + b[1]!.y + b[2]!.y + b[3]!.y) / 4;
  return Math.hypot(ax - bx, ay - by) < size / 2;
}

// #region snippet: pass-plan
/**
 * Which resolutions to attempt, in order. Downscaled passes are cheaper AND
 * act as a low-pass filter, so for huge frames they run first; full
 * resolution always remains in the list. tryHarder adds a 2× pass for
 * normal-sized frames to catch blurry/oversampled codes.
 */
function planScales(gray: GrayImage, options: DecodeImageOptions): number[] {
  const maxDownscale = Math.max(1, Math.floor(options.maxDownscale ?? 1));
  const longestSide = Math.max(gray.width, gray.height);
  const shortestSide = Math.min(gray.width, gray.height);

  const scales: number[] = [];
  let auto = 1;
  while (auto * 2 <= maxDownscale && longestSide / auto > AUTO_DOWNSCALE_THRESHOLD) {
    auto *= 2;
  }
  if (auto > 1) scales.push(auto);
  scales.push(1);
  if (options.tryHarder === true && !scales.includes(2) && shortestSide / 2 >= MIN_DECODABLE_SIZE) {
    scales.push(2);
  }
  return scales;
}
// #endregion snippet
