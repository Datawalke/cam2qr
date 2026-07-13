/**
 * Comparative benchmark: cam2qr vs jsQR vs @zxing/library — detection rates
 * across distortion sweeps and decode speed. jsqr/@zxing/library are
 * devDependencies used as measurement baselines only; nothing here ships.
 *
 * Run with `pnpm compare`; regenerates docs/benchmarks.md.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import { performance } from 'node:perf_hooks';
import {
  BinaryBitmap,
  DecodeHintType,
  HybridBinarizer,
  QRCodeReader,
  RGBLuminanceSource,
} from '@zxing/library';
import jsQR from 'jsqr';
import { describe, expect, it } from 'vitest';
import { decode } from '../../src/decode.js';
import type { ImageDataLike } from '../../src/types.js';
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

type NamedDecoder = { name: string; decode: (image: ImageDataLike) => string | null };

const DECODERS: NamedDecoder[] = [
  { name: 'cam2qr', decode: (image) => decode(image)?.text ?? null },
  {
    name: 'cam2qr (tryHarder)',
    decode: (image) => decode(image, { tryHarder: true })?.text ?? null,
  },
  {
    name: 'jsQR',
    decode: (image) =>
      jsQR(toClamped(image.data), image.width, image.height, { inversionAttempts: 'attemptBoth' })
        ?.data ?? null,
  },
  { name: '@zxing/library', decode: zxingDecode },
];

function toClamped(data: Uint8ClampedArray | Uint8Array): Uint8ClampedArray {
  return data instanceof Uint8ClampedArray ? data : new Uint8ClampedArray(data);
}

function zxingDecode(image: ImageDataLike): string | null {
  const gray = new Uint8ClampedArray(image.width * image.height);
  for (let i = 0; i < gray.length; i++) {
    const offset = i * 4;
    gray[i] =
      (299 * image.data[offset]! + 587 * image.data[offset + 1]! + 114 * image.data[offset + 2]!) /
      1000;
  }
  try {
    const source = new RGBLuminanceSource(gray, image.width, image.height);
    const bitmap = new BinaryBitmap(new HybridBinarizer(source));
    const hints = new Map<DecodeHintType, unknown>();
    hints.set(DecodeHintType.TRY_HARDER, true);
    return new QRCodeReader().decode(bitmap, hints).getText();
  } catch {
    return null;
  }
}

interface Frame {
  image: ImageDataLike;
  expected: string;
}

interface Scenario {
  name: string;
  frames: Frame[];
  /** CI floor for cam2qr (tryHarder) — the comparison itself is informational. */
  minTryHarderRate: number;
}

const FRAMES_PER_SCENARIO = 25;

function randomPayload(random: () => number): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789 $%*+-./:';
  let payload = '';
  for (let i = 0; i < 20; i++) payload += chars[Math.floor(random() * chars.length)]!;
  return payload;
}

function makeScenario(
  name: string,
  seed: number,
  minTryHarderRate: number,
  transform: (image: ImageDataLike, random: () => number) => ImageDataLike,
): Scenario {
  const random = mulberry32(seed);
  const frames: Frame[] = [];
  for (let i = 0; i < FRAMES_PER_SCENARIO; i++) {
    const expected = randomPayload(random);
    const clean = renderMatrix(generate(expected, { version: 2, level: 'M' }).matrix, {
      scale: 6,
      margin: 4,
    });
    frames.push({ image: transform(clean, random), expected });
  }
  return { name, frames, minTryHarderRate };
}

function perspectiveWarp(image: ImageDataLike, random: () => number): ImageDataLike {
  const jitter = () => random() * 0.09 * image.width;
  return warpImage(
    image,
    [
      { x: jitter(), y: jitter() },
      { x: image.width - jitter(), y: jitter() },
      { x: image.width - jitter(), y: image.height - jitter() },
      { x: jitter(), y: image.height - jitter() },
    ],
    image.width,
    image.height,
  );
}

function buildScenarios(): Scenario[] {
  return [
    makeScenario('clean render', 1, 1, (image) => image),
    makeScenario('rotated 30°', 2, 0.9, (image) => rotateImage(image, Math.PI / 6)),
    makeScenario('perspective (≤9% pull)', 3, 0.9, perspectiveWarp),
    makeScenario('salt & pepper noise 2%', 4, 0.9, (image, random) =>
      addSaltPepperNoise(image, 0.02, random),
    ),
    makeScenario('lighting gradient 0.35→1.0', 5, 0.9, (image) =>
      applyIlluminationGradient(image, 0.35, 1),
    ),
    makeScenario('low contrast (110–165)', 6, 0.9, (image) => reduceContrast(image, 110, 165)),
    makeScenario('box blur r=1', 7, 0.9, (image) => boxBlur(image, 1)),
    makeScenario('box blur r=2', 8, 0.5, (image) => boxBlur(image, 2)),
    makeScenario('inverted', 9, 1, invertImage),
  ];
}

/** Median wall-clock ms per decode over `iterations` runs. */
function timeDecoder(
  decoder: NamedDecoder,
  image: ImageDataLike,
  iterations = 40,
  warmup = 5,
): number {
  for (let i = 0; i < warmup; i++) decoder.decode(image);
  const samples: number[] = [];
  for (let i = 0; i < iterations; i++) {
    const start = performance.now();
    decoder.decode(image);
    samples.push(performance.now() - start);
  }
  samples.sort((a, b) => a - b);
  return samples[Math.floor(samples.length / 2)]!;
}

/** The clean v2 symbol embedded off-center in a 1280×720 white frame. */
function embedIn720p(symbol: ImageDataLike): ImageDataLike {
  const width = 1280;
  const height = 720;
  const data = new Uint8ClampedArray(width * height * 4).fill(255);
  const offsetX = 480;
  const offsetY = 240;
  for (let y = 0; y < symbol.height; y++) {
    for (let x = 0; x < symbol.width; x++) {
      const src = (y * symbol.width + x) * 4;
      const dst = ((y + offsetY) * width + (x + offsetX)) * 4;
      data[dst] = symbol.data[src]!;
      data[dst + 1] = symbol.data[src + 1]!;
      data[dst + 2] = symbol.data[src + 2]!;
    }
  }
  return { data, width, height };
}

describe('cam2qr vs jsQR vs @zxing/library', () => {
  it('measures detection rates and speed, regenerates docs/benchmarks.md', () => {
    const scenarios = buildScenarios();

    // Detection rates: decoded text must match the payload exactly.
    const rates = new Map<string, Map<string, number>>();
    for (const scenario of scenarios) {
      const byDecoder = new Map<string, number>();
      for (const decoder of DECODERS) {
        let correct = 0;
        for (const frame of scenario.frames) {
          if (decoder.decode(frame.image) === frame.expected) correct++;
        }
        byDecoder.set(decoder.name, correct / scenario.frames.length);
      }
      rates.set(scenario.name, byDecoder);
    }

    // Speed on a clean small frame and a 720p frame with one symbol.
    const smallFrame = scenarios[0]!.frames[0]!.image;
    const hdFrame = embedIn720p(smallFrame);
    const downscaling: NamedDecoder = {
      name: 'cam2qr (maxDownscale 2 — scanner default)',
      decode: (image) => decode(image, { maxDownscale: 2 })?.text ?? null,
    };
    const speed = [...DECODERS, downscaling].map((decoder) => ({
      name: decoder.name,
      smallMs: timeDecoder(decoder, smallFrame),
      hdMs: timeDecoder(decoder, hdFrame, 20),
    }));

    writeReport(scenarios, rates, speed);

    for (const scenario of scenarios) {
      const rate = rates.get(scenario.name)!.get('cam2qr (tryHarder)')!;
      expect(
        rate,
        `cam2qr (tryHarder) on "${scenario.name}" fell below ${scenario.minTryHarderRate}`,
      ).toBeGreaterThanOrEqual(scenario.minTryHarderRate);
    }
    expect(rates.get('clean render')!.get('cam2qr')).toBe(1);
  });
});

function writeReport(
  scenarios: Scenario[],
  rates: Map<string, Map<string, number>>,
  speed: Array<{ name: string; smallMs: number; hdMs: number }>,
): void {
  const names = DECODERS.map((decoder) => decoder.name);
  const lines: string[] = [
    '# Benchmarks: cam2qr vs jsQR vs @zxing/library',
    '',
    'Regenerate with `pnpm compare` (writes this file). Synthetic frames from the',
    'test renderer, seeded and reproducible; decoded text must match the payload',
    `exactly. ${FRAMES_PER_SCENARIO} frames per scenario, version-2 symbols.`,
    '',
    `Environment: Node ${process.version}, ${os.cpus()[0]?.model ?? 'unknown CPU'}.`,
    '',
    '## Detection rate',
    '',
    `| Scenario | ${names.join(' | ')} |`,
    `|---|${names.map(() => '---').join('|')}|`,
  ];
  for (const scenario of scenarios) {
    const cells = names.map((name) => `${Math.round(rates.get(scenario.name)!.get(name)! * 100)}%`);
    lines.push(`| ${scenario.name} | ${cells.join(' | ')} |`);
  }
  lines.push(
    '',
    '## Decode speed (median ms/frame)',
    '',
    '| Decoder | clean ~200×200 | 1280×720, one symbol |',
    '|---|---|---|',
  );
  for (const entry of speed) {
    lines.push(`| ${entry.name} | ${entry.smallMs.toFixed(2)} | ${entry.hdMs.toFixed(2)} |`);
  }
  lines.push(
    '',
    'Notes: jsQR runs with `inversionAttempts: attemptBoth`; @zxing/library runs',
    'its QR reader with `TRY_HARDER` and a hybrid binarizer. cam2qr rows show the',
    'default configuration and `tryHarder` separately.',
    '',
  );
  mkdirSync('docs', { recursive: true });
  writeFileSync('docs/benchmarks.md', lines.join('\n'));
}
