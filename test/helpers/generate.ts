import QRCode from 'qrcode';
import toSJIS from 'qrcode/helper/to-sjis.js';
import { BitMatrix } from '../../src/core/bit-matrix.js';
import type { ErrorCorrectionLevel } from '../../src/types.js';

export interface GeneratedQr {
  matrix: BitMatrix;
  version: number;
  mask: number;
  level: ErrorCorrectionLevel;
}

const LEVEL_FROM_BIT: Record<number, ErrorCorrectionLevel> = {
  0: 'M',
  1: 'L',
  2: 'H',
  3: 'Q',
};

interface QrCodeModules {
  size: number;
  get(row: number, col: number): number | boolean;
}

interface QrCodeModel {
  modules: QrCodeModules;
  version: number;
  maskPattern: number;
  errorCorrectionLevel: { bit: number };
}

export interface GenerateOptions {
  version?: number;
  level?: ErrorCorrectionLevel;
  mask?: number;
}

/**
 * Generates a QR symbol with the external `qrcode` package (generation only —
 * decoding is ours) and converts it to our BitMatrix.
 */
export function generate(
  payload: string | Array<{ data: Uint8Array | string; mode?: string }>,
  options: GenerateOptions = {},
): GeneratedQr {
  const qr = QRCode.create(payload as never, {
    errorCorrectionLevel: options.level ?? 'M',
    toSJISFunc: toSJIS as (char: string) => number, // enables kanji-mode segments
    ...(options.version !== undefined ? { version: options.version } : {}),
    ...(options.mask !== undefined ? { maskPattern: options.mask as never } : {}),
  }) as unknown as QrCodeModel;

  const size = qr.modules.size;
  const matrix = new BitMatrix(size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      matrix.set(x, y, Boolean(qr.modules.get(y, x)));
    }
  }
  return {
    matrix,
    version: qr.version,
    mask: qr.maskPattern,
    level: LEVEL_FROM_BIT[qr.errorCorrectionLevel.bit]!,
  };
}

/** Deterministic PRNG so error-injection tests are reproducible. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
