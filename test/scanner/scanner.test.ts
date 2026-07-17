import { describe, expect, it, vi } from 'vitest';
import { CameraError } from '../../src/camera/errors.js';
import { decode } from '../../src/decode.js';
import { DecodeError } from '../../src/errors.js';
import { QrScanner } from '../../src/scanner/scanner.js';
import type { Detection, ImageDataLike, QrResult } from '../../src/types.js';
import {
  makeFakeMediaDevices,
  makeFakeStream,
  makeFakeTrack,
  makeFakeVideo,
  makeManualInternals,
} from '../helpers/camera-fakes.js';
import { generate } from '../helpers/generate.js';
import { composeHorizontal, renderMatrix } from '../helpers/image.js';

function qrFrame(payload: string): ImageDataLike {
  return renderMatrix(generate(payload, { version: 2, level: 'M' }).matrix, {
    scale: 6,
    margin: 4,
  });
}

function blankFrame(size = 200): ImageDataLike {
  return { data: new Uint8ClampedArray(size * size * 4).fill(255), width: size, height: size };
}

function makeScanner(options: {
  frames?: () => ImageDataLike | null;
  scannerOptions?: ConstructorParameters<typeof QrScanner>[1];
  capabilities?: Record<string, unknown>;
  createRunner?: NonNullable<Parameters<typeof makeManualInternals>[0]>['createRunner'];
}) {
  const track = makeFakeTrack(options.capabilities ?? {});
  const stream = makeFakeStream(track);
  const mediaDevices = makeFakeMediaDevices(stream);
  const video = makeFakeVideo();
  const harness = makeManualInternals({
    frame: options.frames ?? (() => null),
    mediaDevices,
    ...(options.createRunner ? { createRunner: options.createRunner } : {}),
  });
  const scanner = new QrScanner(video, options.scannerOptions ?? {}, harness.internals);
  return { scanner, track, mediaDevices, video, ...harness };
}

/** A minimal decoded part carrying a structured-append header. */
function structuredPart(index: number, total: number, parity: number, text: string): QrResult {
  const bytes = new TextEncoder().encode(text);
  return {
    text,
    bytes,
    cornerPoints: [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
      { x: 0, y: 10 },
    ],
    moduleSize: 2,
    version: 1,
    errorCorrectionLevel: 'M',
    mask: 0,
    segments: [{ mode: 'byte', bytes, text }],
    ecc: { blocks: 1, codewordsCorrected: 0 },
    structuredAppend: { index, total, parity },
  };
}

function parityOf(text: string): number {
  let parity = 0;
  for (const byte of new TextEncoder().encode(text)) parity ^= byte;
  return parity;
}

describe('QrScanner', () => {
  it('starts the camera and emits decode events with payload and geometry', async () => {
    const decoded: QrResult[] = [];
    const { scanner, mediaDevices, video, loop } = makeScanner({
      frames: () => qrFrame('scan me'),
      scannerOptions: { onDecode: (r) => decoded.push(r) },
    });

    const started = vi.fn();
    scanner.on('start', started);
    await scanner.start();

    expect(started).toHaveBeenCalledOnce();
    expect(mediaDevices.getUserMedia).toHaveBeenCalledWith(
      expect.objectContaining({
        video: expect.objectContaining({ facingMode: { ideal: 'environment' } }),
      }),
    );
    expect(video.srcObject).not.toBeNull();
    expect(video.play).toHaveBeenCalled();

    await loop.runTick();
    expect(decoded).toHaveLength(1);
    expect(decoded[0]!.text).toBe('scan me');
    expect(decoded[0]!.cornerPoints).toHaveLength(4);
    scanner.destroy();
  });

  it('deduplicates repeats and re-fires after the quiet window', async () => {
    const decoded: string[] = [];
    const { scanner, loop, clock } = makeScanner({
      frames: () => qrFrame('same code'),
      scannerOptions: { onDecode: (r) => decoded.push(r.text), dedupeWindowMs: 1500 },
    });
    await scanner.start();

    await loop.runTick();
    clock.advance(100);
    await loop.runTick();
    clock.advance(100);
    await loop.runTick();
    expect(decoded).toHaveLength(1);

    clock.advance(5000); // out of sight longer than the window
    await loop.runTick();
    expect(decoded).toHaveLength(2);
    scanner.destroy();
  });

  it('fires immediately when the payload changes', async () => {
    const decoded: string[] = [];
    let payload = 'first';
    const { scanner, loop, clock } = makeScanner({
      frames: () => qrFrame(payload),
      scannerOptions: { onDecode: (r) => decoded.push(r.text) },
    });
    await scanner.start();

    await loop.runTick();
    payload = 'second';
    clock.advance(100);
    await loop.runTick();
    expect(decoded).toEqual(['first', 'second']);
    scanner.destroy();
  });

  it('throttles decode attempts to maxScansPerSecond', async () => {
    const { scanner, loop, frameSource, clock } = makeScanner({
      frames: () => qrFrame('throttled'),
      scannerOptions: { maxScansPerSecond: 10, dedupeWindowMs: 0 },
    });
    await scanner.start();

    await loop.runTick(); // decodes (first frame)
    await loop.runTick(); // within 100ms budget → skipped, no grab
    expect(frameSource.regions).toHaveLength(1);

    clock.advance(101);
    await loop.runTick();
    expect(frameSource.regions).toHaveLength(2);
    scanner.destroy();
  });

  it('emits detect with candidates per frame, and null on empty frames', async () => {
    let frame = qrFrame('track me');
    const detections: Array<Detection[] | null> = [];
    const { scanner, loop, clock } = makeScanner({
      frames: () => frame,
      scannerOptions: { onDetect: (d) => detections.push(d) },
    });
    await scanner.start();

    await loop.runTick();
    expect(detections).toHaveLength(1);
    expect(detections[0]).not.toBeNull();
    expect(detections[0]![0]!.cornerPoints).toHaveLength(4);
    expect(detections[0]![0]!.moduleSize).toBeGreaterThan(0);

    frame = blankFrame();
    clock.advance(100);
    await loop.runTick();
    expect(detections).toHaveLength(2);
    expect(detections[1]).toBeNull();
    scanner.destroy();
  });

  it('offsets detect corner points back into full-video coordinates', async () => {
    const image = qrFrame('region detect');
    const region = { x: 25, y: 35, width: image.width, height: image.height };
    const detections: Array<Detection[] | null> = [];
    const { scanner, loop } = makeScanner({
      frames: () => image,
      scannerOptions: { scanRegion: region, onDetect: (d) => detections.push(d) },
    });
    await scanner.start();
    await loop.runTick();

    const direct = decode(image)!;
    expect(detections[0]![0]!.cornerPoints[0]!.x).toBeCloseTo(
      direct.cornerPoints[0]!.x + region.x,
      5,
    );
    expect(detections[0]![0]!.cornerPoints[0]!.y).toBeCloseTo(
      direct.cornerPoints[0]!.y + region.y,
      5,
    );
    scanner.destroy();
  });

  it('multiple mode decodes every code in the frame', async () => {
    const frame = composeHorizontal([qrFrame('multi one'), qrFrame('multi two')]);
    const decoded: string[] = [];
    const { scanner, loop, clock } = makeScanner({
      frames: () => frame,
      scannerOptions: { multiple: true, onDecode: (r) => decoded.push(r.text) },
    });
    await scanner.start();

    await loop.runTick();
    expect(decoded.sort()).toEqual(['multi one', 'multi two']);

    // Both stay in view: neither re-fires inside the dedupe window.
    clock.advance(100);
    await loop.runTick();
    expect(decoded).toHaveLength(2);
    scanner.destroy();
  });

  it('reassembles structured-append sequences across frames', async () => {
    const parity = parityOf('hello world');
    const frames: QrResult[][] = [
      [structuredPart(0, 2, parity, 'hello ')],
      [structuredPart(1, 2, parity, 'world')],
    ];
    let tick = 0;
    const decoded: QrResult[] = [];
    const { scanner, loop, clock } = makeScanner({
      frames: () => blankFrame(),
      createRunner: () => ({
        scan: async () => ({
          results: frames[Math.min(tick++, frames.length - 1)]!,
          detections: [],
        }),
        destroy() {},
      }),
      scannerOptions: { onDecode: (r) => decoded.push(r) },
    });
    await scanner.start();

    await loop.runTick(); // part 0 only — withheld
    expect(decoded).toHaveLength(0);
    clock.advance(100);
    await loop.runTick(); // part 1 completes the sequence
    expect(decoded).toHaveLength(1);
    expect(decoded[0]!.text).toBe('hello world');

    // The sequence stays complete while in view; dedupe suppresses re-fires.
    clock.advance(100);
    await loop.runTick();
    expect(decoded).toHaveLength(1);
    scanner.destroy();
  });

  it('emits structured-append parts individually when configured', async () => {
    const parity = parityOf('ab');
    const decoded: string[] = [];
    const { scanner, loop } = makeScanner({
      frames: () => blankFrame(),
      createRunner: () => ({
        scan: async () => ({
          results: [structuredPart(0, 2, parity, 'a'), structuredPart(1, 2, parity, 'b')],
          detections: [],
        }),
        destroy() {},
      }),
      scannerOptions: {
        structuredAppend: 'individual',
        multiple: true,
        onDecode: (r) => decoded.push(r.text),
      },
    });
    await scanner.start();
    await loop.runTick();
    expect(decoded).toEqual(['a', 'b']);
    scanner.destroy();
  });

  it('stops after the first decode with stopOnDecode', async () => {
    const decoded: string[] = [];
    const { scanner, track, loop } = makeScanner({
      frames: () => qrFrame('one shot'),
      scannerOptions: { onDecode: (r) => decoded.push(r.text), stopOnDecode: true },
    });
    const stopped = vi.fn();
    scanner.on('stop', stopped);
    await scanner.start();

    await loop.runTick();
    expect(decoded).toEqual(['one shot']);
    expect(stopped).toHaveBeenCalledOnce();
    expect(track.stop).toHaveBeenCalled();
    expect(loop.pendingTicks()).toBe(0);
    scanner.destroy();
  });

  it('stop() releases the camera and clears the video element', async () => {
    const { scanner, track, video } = makeScanner({});
    await scanner.start();
    scanner.stop();
    expect(track.stop).toHaveBeenCalled();
    expect(video.srcObject).toBeNull();
    scanner.destroy();
  });

  it('pause() keeps the stream; resume() continues scanning', async () => {
    const decoded: string[] = [];
    const { scanner, track, loop, clock } = makeScanner({
      frames: () => qrFrame('pausable'),
      scannerOptions: { onDecode: (r) => decoded.push(r.text) },
    });
    await scanner.start();
    scanner.pause();
    expect(loop.pendingTicks()).toBe(0);
    expect(track.stop).not.toHaveBeenCalled();

    scanner.resume();
    clock.advance(1000);
    await loop.runTick();
    expect(decoded).toEqual(['pausable']);
    scanner.destroy();
  });

  it('honors a pause() requested during the async starting window', async () => {
    const decoded: string[] = [];
    const { scanner, track, loop, clock } = makeScanner({
      frames: () => qrFrame('suspended start'),
      scannerOptions: { onDecode: (r) => decoded.push(r.text) },
    });

    // Pause while start() is mid-flight (state 'starting'): it must land, not
    // silently no-op, so the scanner comes up suspended.
    const starting = scanner.start();
    scanner.pause();
    await starting;

    expect(track.stop).not.toHaveBeenCalled(); // stream kept warm
    expect(loop.pendingTicks()).toBe(0); // no scan loop scheduled
    await loop.runTick();
    expect(decoded).toHaveLength(0);

    // Resuming continues without re-requesting the camera.
    scanner.resume();
    clock.advance(1000);
    await loop.runTick();
    expect(decoded).toEqual(['suspended start']);
    scanner.destroy();
  });

  it('surfaces decode-runner faults as DecodeError, not CameraError', async () => {
    const errors: Array<CameraError | DecodeError> = [];
    const { scanner, loop } = makeScanner({
      frames: () => qrFrame('boom'),
      createRunner: () => ({
        scan: async () => {
          throw new Error('decode worker crashed');
        },
        destroy() {},
      }),
      scannerOptions: { onError: (e) => errors.push(e) },
    });
    await scanner.start();
    await loop.runTick();

    expect(errors).toHaveLength(1);
    expect(errors[0]).toBeInstanceOf(DecodeError);
    expect(errors[0]).not.toBeInstanceOf(CameraError);
    expect((errors[0] as DecodeError).code).toBe('runner-failed');
    scanner.destroy();
  });

  it('rejects start() with a typed error when permission is denied', async () => {
    const video = makeFakeVideo();
    const harness = makeManualInternals({
      mediaDevices: {
        getUserMedia: async () => {
          throw { name: 'NotAllowedError', message: 'denied' };
        },
      } as unknown as MediaDevices,
    });
    const scanner = new QrScanner(video, {}, harness.internals);
    await expect(scanner.start()).rejects.toMatchObject({
      name: 'CameraError',
      code: 'permission-denied',
    });
    scanner.destroy();
  });

  it('crops to the scan region and offsets corner points back', async () => {
    const image = qrFrame('region test');
    const region = { x: 40, y: 30, width: image.width, height: image.height };
    const decoded: QrResult[] = [];
    const { scanner, loop, frameSource } = makeScanner({
      frames: () => image,
      scannerOptions: { scanRegion: region, onDecode: (r) => decoded.push(r) },
    });
    await scanner.start();
    await loop.runTick();

    expect(frameSource.regions[0]).toEqual(region);
    expect(decoded).toHaveLength(1);
    const direct = decode(image);
    expect(direct).not.toBeNull();
    // Corner points are reported in full-video coordinates.
    expect(decoded[0]!.cornerPoints[0]!.x).toBeCloseTo(direct!.cornerPoints[0]!.x + region.x, 5);
    expect(decoded[0]!.cornerPoints[0]!.y).toBeCloseTo(direct!.cornerPoints[0]!.y + region.y, 5);
    scanner.destroy();
  });

  it('controls torch when the track supports it', async () => {
    const { scanner, track } = makeScanner({ capabilities: { torch: true } });
    await scanner.start();
    expect(scanner.getCapabilities()).toEqual({ torch: true, zoom: null });
    expect(await scanner.setTorch(true)).toBe(true);
    expect(track.applyConstraints).toHaveBeenCalledWith({ advanced: [{ torch: true }] });
    scanner.destroy();
  });

  it('reports torch as unsupported gracefully', async () => {
    const { scanner, track } = makeScanner({});
    await scanner.start();
    expect(await scanner.setTorch(true)).toBe(false);
    expect(track.applyConstraints).not.toHaveBeenCalled();
    scanner.destroy();
  });

  it('setCamera() swaps the stream and keeps scanning', async () => {
    const decoded: string[] = [];
    const { scanner, mediaDevices, track, loop } = makeScanner({
      frames: () => qrFrame('after switch'),
      scannerOptions: { onDecode: (r) => decoded.push(r.text) },
    });
    await scanner.start();
    await scanner.setCamera({ facing: 'user' });

    expect(track.stop).toHaveBeenCalled(); // old stream released
    expect(mediaDevices.getUserMedia).toHaveBeenLastCalledWith(
      expect.objectContaining({
        video: expect.objectContaining({ facingMode: { ideal: 'user' } }),
      }),
    );
    await loop.runTick();
    expect(decoded).toEqual(['after switch']);
    scanner.destroy();
  });

  it('update() adjusts runtime options', async () => {
    const decoded: string[] = [];
    const { scanner, loop, clock } = makeScanner({
      frames: () => qrFrame('tunable'),
      scannerOptions: { onDecode: (r) => decoded.push(r.text), dedupeWindowMs: 100_000 },
    });
    await scanner.start();
    await loop.runTick();
    expect(decoded).toHaveLength(1);

    scanner.update({ dedupeWindowMs: 100 });
    clock.advance(500);
    await loop.runTick();
    expect(decoded).toHaveLength(2);
    scanner.destroy();
  });

  it('skips ticks when no frame is available yet', async () => {
    const { scanner, loop } = makeScanner({ frames: () => null });
    const errors = vi.fn();
    scanner.on('error', errors);
    await scanner.start();
    await loop.runTick();
    await loop.runTick();
    expect(errors).not.toHaveBeenCalled();
    expect(loop.pendingTicks()).toBe(1); // loop keeps rescheduling
    scanner.destroy();
  });

  it('start() after destroy() throws', async () => {
    const { scanner } = makeScanner({});
    scanner.destroy();
    await expect(scanner.start()).rejects.toThrow('destroyed');
  });

  it('off() unsubscribes listeners', async () => {
    const { scanner, loop } = makeScanner({ frames: () => qrFrame('bye') });
    const listener = vi.fn();
    scanner.on('decode', listener);
    scanner.off('decode', listener);
    await scanner.start();
    await loop.runTick();
    expect(listener).not.toHaveBeenCalled();
    scanner.destroy();
  });
});
