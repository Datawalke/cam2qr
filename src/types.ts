export type ErrorCorrectionLevel = 'L' | 'M' | 'Q' | 'H';

export interface Point {
  x: number;
  y: number;
}

/** Minimal structural form of a canvas `ImageData`: RGBA bytes, row-major. */
export interface ImageDataLike {
  data: Uint8ClampedArray | Uint8Array;
  width: number;
  height: number;
}

export interface DecodeImageOptions {
  /**
   * Also try the inverted image (light modules on a dark background) when
   * the first pass finds nothing. Cheap; defaults to true.
   */
  tryInverted?: boolean;
  /**
   * Spend more time per frame: try several finder-pattern triples (defeats
   * decoy patterns) and an extra 2× downscale pass (recovers blurry or
   * oversampled codes). Default false.
   */
  tryHarder?: boolean;
  /**
   * Allow automatic downsampling of frames larger than ~1000px by up to
   * this integer factor before decoding — much faster on 4K frames, and
   * full resolution is still tried when the fast pass fails. Default 1
   * (never downscale).
   */
  maxDownscale?: number;
  /**
   * Classify the payload (URL, WiFi credentials, vCard, geo, tel, sms,
   * email) into `result.content`. Default true.
   */
  parseContent?: boolean;
}

/** A located — not necessarily decoded — QR symbol candidate. */
export interface Detection {
  /**
   * Symbol outline in image pixel coordinates:
   * top-left, top-right, bottom-right, bottom-left.
   */
  cornerPoints: [Point, Point, Point, Point];
  /** Estimated module size in pixels. */
  moduleSize: number;
}

export interface DetectImageOptions {
  /** Also look for inverted (light-on-dark) symbols. Default true. */
  tryInverted?: boolean;
  /** Downscale huge frames by up to this factor first (see decode). Default 1. */
  maxDownscale?: number;
  /** Maximum number of distinct candidates to return. Default 4. */
  maxCandidates?: number;
}

export type Segment =
  | { mode: 'numeric'; text: string }
  | { mode: 'alphanumeric'; text: string }
  | { mode: 'byte'; bytes: Uint8Array; text: string }
  | { mode: 'kanji'; bytes: Uint8Array; text: string }
  | { mode: 'eci'; assignment: number };

/**
 * FNC1 marker: first position marks GS1-formatted data (element strings
 * separated by GS, parsed into `content` when recognizable); second position
 * marks AIM data with an application indicator.
 */
export type Fnc1 = { position: 'first' } | { position: 'second'; applicationIndicator: string };

export interface StructuredAppend {
  /** 0-based position of this symbol in the sequence. */
  index: number;
  /** Total symbols in the sequence. */
  total: number;
  /** Parity byte shared by all symbols of the sequence. */
  parity: number;
}

/** Result of decoding a sampled bit matrix (no image geometry attached). */
export interface DecodedMatrix {
  text: string;
  bytes: Uint8Array;
  version: number;
  errorCorrectionLevel: ErrorCorrectionLevel;
  mask: number;
  segments: Segment[];
  ecc: {
    /** Number of Reed–Solomon blocks in the symbol. */
    blocks: number;
    /** Codewords that had to be corrected — a quality/damage signal. */
    codewordsCorrected: number;
  };
  structuredAppend?: StructuredAppend;
  /** Present when the symbol carries FNC1/GS1 markers. */
  fnc1?: Fnc1;
}

/** Result of decoding a QR code found in an image. */
export interface QrResult extends DecodedMatrix {
  /**
   * Symbol outline in image pixel coordinates:
   * top-left, top-right, bottom-right, bottom-left.
   */
  cornerPoints: [Point, Point, Point, Point];
  /** Measured module size in pixels — a proxy for scan distance/quality. */
  moduleSize: number;
  /** Payload classification (unless parseContent: false). */
  content?: import('./content/parse.js').ParsedContent;
}
