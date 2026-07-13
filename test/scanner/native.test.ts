import { afterEach, describe, expect, it, vi } from 'vitest';
import { createDecodeRunner } from '../../src/scanner/runner.js';
import type { ImageDataLike, Point } from '../../src/types.js';
import { generate } from '../helpers/generate.js';
import { renderMatrix } from '../helpers/image.js';

const CORNERS: Point[] = [
  { x: 5, y: 5 },
  { x: 105, y: 5 },
  { x: 105, y: 105 },
  { x: 5, y: 105 },
];

class FakeImageData {
  constructor(
    public data: Uint8ClampedArray,
    public width: number,
    public height: number,
  ) {}
}

function blankFrame(size = 50): ImageDataLike {
  return { data: new Uint8ClampedArray(size * size * 4).fill(255), width: size, height: size };
}

function qrFrame(payload: string): ImageDataLike {
  return renderMatrix(generate(payload, { version: 2, level: 'M' }).matrix, {
    scale: 6,
    margin: 4,
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('useNativeDetector runner', () => {
  it('maps BarcodeDetector results into QrResults with placeholder metadata', async () => {
    vi.stubGlobal('ImageData', FakeImageData);
    vi.stubGlobal(
      'BarcodeDetector',
      class {
        async detect(): Promise<unknown[]> {
          return [{ rawValue: 'https://native.example', cornerPoints: CORNERS }];
        }
      },
    );

    const runner = createDecodeRunner(false, true);
    const scan = await runner.scan(blankFrame(), {});
    expect(scan.results).toHaveLength(1);
    const result = scan.results[0]!;
    expect(result.text).toBe('https://native.example');
    expect(result.content).toEqual({ type: 'url', url: 'https://native.example' });
    expect(result.cornerPoints[2]).toEqual({ x: 105, y: 105 });
    expect(result.version).toBe(0); // placeholder: native API exposes no codec metadata
    expect(result.mask).toBe(-1);
    expect(result.moduleSize).toBeCloseTo(4, 1); // ~100px side / 25
    expect(scan.detections).toHaveLength(1);
    runner.destroy();
  });

  it('returns one result unless multiple is set, but reports all detections', async () => {
    vi.stubGlobal('ImageData', FakeImageData);
    vi.stubGlobal(
      'BarcodeDetector',
      class {
        async detect(): Promise<unknown[]> {
          return [
            { rawValue: 'one', cornerPoints: CORNERS },
            { rawValue: 'two', cornerPoints: CORNERS.map((p) => ({ x: p.x + 200, y: p.y })) },
          ];
        }
      },
    );

    const runner = createDecodeRunner(false, true);
    const single = await runner.scan(blankFrame(), {});
    expect(single.results.map((r) => r.text)).toEqual(['one']);
    expect(single.detections).toHaveLength(2);

    const multiple = await runner.scan(blankFrame(), { multiple: true });
    expect(multiple.results.map((r) => r.text)).toEqual(['one', 'two']);
    runner.destroy();
  });

  it('permanently falls back to our engine when detect() throws', async () => {
    vi.stubGlobal('ImageData', FakeImageData);
    let calls = 0;
    vi.stubGlobal(
      'BarcodeDetector',
      class {
        async detect(): Promise<unknown[]> {
          calls++;
          throw new Error('shape detection backend unavailable');
        }
      },
    );

    const runner = createDecodeRunner(false, true);
    const scan = await runner.scan(qrFrame('engine fallback'), {});
    expect(scan.results[0]!.text).toBe('engine fallback');
    expect(scan.results[0]!.version).toBe(2); // decoded by our engine, real metadata

    await runner.scan(qrFrame('still engine'), {});
    expect(calls).toBe(1); // native path never retried
    runner.destroy();
  });

  it('uses our engine when BarcodeDetector does not exist or cannot construct', async () => {
    const plain = createDecodeRunner(false, true);
    expect((await plain.scan(qrFrame('no native api'), {})).results[0]!.text).toBe('no native api');
    plain.destroy();

    vi.stubGlobal(
      'BarcodeDetector',
      class {
        constructor() {
          throw new Error('qr_code format unsupported');
        }
      },
    );
    const failed = createDecodeRunner(false, true);
    expect((await failed.scan(qrFrame('ctor threw'), {})).results[0]!.text).toBe('ctor threw');
    failed.destroy();
  });
});
