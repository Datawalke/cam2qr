import { vi } from 'vitest';
import type { FrameSource, Region } from '../../src/camera/frame-grabber.js';
import { scanFrame } from '../../src/decode.js';
import type { ScannerInternals } from '../../src/scanner/scanner.js';
import type { ImageDataLike } from '../../src/types.js';

export interface FakeTrack {
  kind: string;
  stop: ReturnType<typeof vi.fn>;
  getCapabilities: ReturnType<typeof vi.fn>;
  applyConstraints: ReturnType<typeof vi.fn>;
}

export function makeFakeTrack(capabilities: Record<string, unknown> = {}): FakeTrack {
  return {
    kind: 'video',
    stop: vi.fn(),
    getCapabilities: vi.fn(() => capabilities),
    applyConstraints: vi.fn(async () => {}),
  };
}

export function makeFakeStream(track: FakeTrack): MediaStream {
  return {
    getTracks: () => [track],
    getVideoTracks: () => [track],
  } as unknown as MediaStream;
}

export function makeFakeMediaDevices(stream: MediaStream): MediaDevices & {
  getUserMedia: ReturnType<typeof vi.fn>;
} {
  return {
    getUserMedia: vi.fn(async () => stream),
    enumerateDevices: vi.fn(async () => []),
  } as unknown as MediaDevices & { getUserMedia: ReturnType<typeof vi.fn> };
}

export function makeFakeVideo(): HTMLVideoElement {
  return {
    videoWidth: 640,
    videoHeight: 480,
    srcObject: null,
    muted: false,
    play: vi.fn(async () => {}),
    pause: vi.fn(),
    setAttribute: vi.fn(),
  } as unknown as HTMLVideoElement;
}

/** Frame source serving a fixed image; records requested regions. */
export function makeFakeFrameSource(frame: () => ImageDataLike | null): FrameSource & {
  regions: Array<Region | undefined>;
} {
  const regions: Array<Region | undefined> = [];
  return {
    regions,
    grab(region?: Region): ImageDataLike | null {
      regions.push(region);
      return frame();
    },
    destroy(): void {},
  };
}

export interface ManualLoop {
  /** Runs the next scheduled tick and lets its async work settle. */
  runTick(): Promise<void>;
  pendingTicks(): number;
}

/**
 * Test harness around ScannerInternals: manual tick scheduling and a
 * controllable clock.
 */
export function makeManualInternals(
  overrides: Partial<ScannerInternals> & { frame?: () => ImageDataLike | null } = {},
): {
  internals: ScannerInternals;
  loop: ManualLoop;
  clock: { advance(ms: number): void; now(): number };
  frameSource: ReturnType<typeof makeFakeFrameSource>;
} {
  const ticks: Array<() => void> = [];
  let currentTime = 100_000;
  const frameSource = makeFakeFrameSource(overrides.frame ?? (() => null));

  const internals: ScannerInternals = {
    createFrameSource: () => frameSource,
    createRunner:
      overrides.createRunner ??
      (() => ({
        scan: (image, options) => Promise.resolve(scanFrame(image, options)),
        destroy() {},
      })),
    now: () => currentTime,
    schedule: (_video, callback) => {
      ticks.push(callback);
      return () => {
        const index = ticks.indexOf(callback);
        if (index >= 0) ticks.splice(index, 1);
      };
    },
    ...(overrides.mediaDevices ? { mediaDevices: overrides.mediaDevices } : {}),
  };

  return {
    internals,
    frameSource,
    clock: {
      advance: (ms) => {
        currentTime += ms;
      },
      now: () => currentTime,
    },
    loop: {
      async runTick(): Promise<void> {
        const callback = ticks.shift();
        callback?.();
        // Let the async tick body (decode promise) settle.
        await new Promise((resolve) => setTimeout(resolve, 0));
      },
      pendingTicks: () => ticks.length,
    },
  };
}
