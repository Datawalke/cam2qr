import {
  type CameraCapabilities,
  applyTorch,
  applyZoom,
  getTrackCapabilities,
} from '../camera/capabilities.js';
import { CameraError } from '../camera/errors.js';
import { type FrameSource, type Region, createCanvasFrameSource } from '../camera/frame-grabber.js';
import { type CameraOptions, startStream, stopStream } from '../camera/stream.js';
import { DecodeError } from '../errors.js';
import type { Detection, QrResult } from '../types.js';
import { Deduper } from './dedupe.js';
import { type DecodeRunner, createDecodeRunner } from './runner.js';
import { StructuredAppendAssembler } from './structured-append.js';

export interface QrScannerOptions {
  camera?: CameraOptions;
  /** Decode attempts per second; frames in between are skipped. Default 15. */
  maxScansPerSecond?: number;
  /** Restrict decoding to a sub-rectangle of the video (a big CPU saver). */
  scanRegion?: Region | ((video: HTMLVideoElement) => Region);
  /** Decode in a Web Worker when available. Default true. */
  useWorker?: boolean;
  /**
   * Use the browser's BarcodeDetector when available, falling back to our
   * engine when it is missing or fails at runtime. Faster on supporting
   * Chromium, but native results carry placeholder codec metadata (version,
   * mask, ecc, EC level) — see the README. Off by default; fixed at start().
   */
  useNativeDetector?: boolean;
  /** Pause scanning while the page is hidden. Default true. */
  pauseOnHidden?: boolean;
  /** Also try inverted (light-on-dark) symbols. Default true. */
  tryInverted?: boolean;
  /** Extra decode passes per frame (see DecodeImageOptions). Default false. */
  tryHarder?: boolean;
  /** Downscale huge frames by up to this factor before decoding. Default 2. */
  maxDownscale?: number;
  /** Quiet period before the same payload fires again. Default 1500 ms. */
  dedupeWindowMs?: number;
  /** Stop the camera after the first successful decode. Default false. */
  stopOnDecode?: boolean;
  /**
   * Decode every code in the frame instead of stopping at the first; each
   * decoded symbol fires its own decode event (deduped per payload).
   * Default false.
   */
  multiple?: boolean;
  /**
   * How to handle structured-append sequences (one payload split across
   * several symbols): 'reassemble' (default) withholds the parts and fires a
   * single decode event with the joined payload once every symbol has been
   * seen (combine with `multiple` when all symbols share the frame);
   * 'individual' fires each symbol as its own result.
   */
  structuredAppend?: 'reassemble' | 'individual';
  onDecode?: (result: QrResult) => void;
  /**
   * Fires on every scanned frame with the located symbol candidates (video
   * pixel coordinates, before/regardless of a successful decode), or null
   * when the frame contains none — drive live outline overlays with this.
   */
  onDetect?: (detections: Detection[] | null) => void;
  onError?: (error: ScannerError) => void;
}

/**
 * The `error` event carries either flavor of the typed contract: `CameraError`
 * for camera/stream faults (permission, device, stream setup) and `DecodeError`
 * for decode-runner faults (a frame failing to decode, the Web Worker
 * crashing). Match on `error.name` (or `instanceof`) to tell them apart.
 */
export type ScannerError = CameraError | DecodeError;

/** Options changeable while the scanner runs (via update()). */
export type QrScannerUpdate = Pick<
  QrScannerOptions,
  | 'maxScansPerSecond'
  | 'scanRegion'
  | 'tryInverted'
  | 'tryHarder'
  | 'maxDownscale'
  | 'dedupeWindowMs'
  | 'stopOnDecode'
  | 'multiple'
  | 'structuredAppend'
>;

export interface ScannerEventMap {
  decode: QrResult;
  detect: Detection[] | null;
  error: ScannerError;
  start: undefined;
  stop: undefined;
}

/**
 * Internal dependency seams, injectable for tests (fake camera, manual
 * scheduling, controlled clock). Not part of the supported public API.
 */
export interface ScannerInternals {
  mediaDevices?: MediaDevices;
  createFrameSource?: (video: HTMLVideoElement) => FrameSource;
  createRunner?: (useWorker: boolean, useNativeDetector: boolean) => DecodeRunner;
  now?: () => number;
  /** Schedules the next tick; returns a cancel function. */
  schedule?: (video: HTMLVideoElement, callback: () => void) => () => void;
}

type ScannerState = 'idle' | 'starting' | 'scanning' | 'paused' | 'destroyed';

export class QrScanner {
  private readonly video: HTMLVideoElement;
  private readonly options: Required<
    Pick<
      QrScannerOptions,
      | 'maxScansPerSecond'
      | 'useWorker'
      | 'useNativeDetector'
      | 'pauseOnHidden'
      | 'tryInverted'
      | 'tryHarder'
      | 'maxDownscale'
      | 'dedupeWindowMs'
      | 'stopOnDecode'
      | 'multiple'
      | 'structuredAppend'
    >
  > & { camera: CameraOptions; scanRegion: QrScannerOptions['scanRegion'] };
  private readonly internals: Required<ScannerInternals>;
  private readonly deduper: Deduper;
  private readonly assembler = new StructuredAppendAssembler();
  private readonly listeners = new Map<keyof ScannerEventMap, Set<(payload: never) => void>>();

  private state: ScannerState = 'idle';
  private stream: MediaStream | null = null;
  /**
   * Generation token invalidating in-flight stream acquisitions. Every
   * acquisition takes a new generation, and stop()/destroy() bump it; an
   * awaited getUserMedia that resolves under a stale generation no longer
   * owns the scanner — it must stop the stream it acquired and bail instead
   * of resurrecting state that was torn down behind its back.
   */
  private startGen = 0;
  private frameSource: FrameSource | null = null;
  private runner: DecodeRunner | null = null;
  private cancelTick: (() => void) | null = null;
  private lastDecodeAt = Number.NEGATIVE_INFINITY;
  private decoding = false;
  private hiddenPause = false;
  /** A pause requested during the async 'starting' window, honored at start. */
  private pendingPause = false;
  private readonly onVisibilityChange = (): void => {
    if (!this.options.pauseOnHidden || typeof document === 'undefined') return;
    if (document.visibilityState === 'hidden') {
      if (this.state === 'scanning') {
        this.hiddenPause = true;
        this.pause();
      }
    } else if (this.hiddenPause) {
      this.hiddenPause = false;
      this.resume();
    }
  };

  constructor(
    video: HTMLVideoElement,
    options: QrScannerOptions = {},
    internals: ScannerInternals = {},
  ) {
    this.video = video;
    this.options = {
      camera: options.camera ?? {},
      maxScansPerSecond: options.maxScansPerSecond ?? 15,
      scanRegion: options.scanRegion,
      useWorker: options.useWorker ?? true,
      useNativeDetector: options.useNativeDetector ?? false,
      pauseOnHidden: options.pauseOnHidden ?? true,
      tryInverted: options.tryInverted ?? true,
      tryHarder: options.tryHarder ?? false,
      maxDownscale: options.maxDownscale ?? 2,
      dedupeWindowMs: options.dedupeWindowMs ?? 1500,
      stopOnDecode: options.stopOnDecode ?? false,
      multiple: options.multiple ?? false,
      structuredAppend: options.structuredAppend ?? 'reassemble',
    };
    this.internals = {
      mediaDevices: internals.mediaDevices ?? (undefined as unknown as MediaDevices),
      createFrameSource: internals.createFrameSource ?? createCanvasFrameSource,
      createRunner: internals.createRunner ?? createDecodeRunner,
      now: internals.now ?? (() => Date.now()),
      schedule: internals.schedule ?? defaultSchedule,
    };
    this.deduper = new Deduper(this.options.dedupeWindowMs);
    if (options.onDecode) this.on('decode', options.onDecode);
    if (options.onDetect) this.on('detect', options.onDetect);
    if (options.onError) this.on('error', options.onError);
  }

  /** Requests the camera, attaches it to the video, and starts scanning. */
  async start(): Promise<void> {
    if (this.state === 'destroyed') throw new Error('scanner was destroyed');
    if (this.state === 'scanning' || this.state === 'starting') return;
    if (this.state === 'paused' && this.stream) {
      this.resume();
      return;
    }

    this.state = 'starting';
    const gen = ++this.startGen;
    try {
      const stream = await startStream(this.options.camera, this.internals.mediaDevices);
      if (gen !== this.startGen) {
        // stop()/destroy() (or a newer acquisition) superseded us mid-await;
        // the stream we just got has no owner, so release it and stay down.
        stopStream(stream);
        return;
      }
      this.stream = stream;
      await this.attachStream();
    } catch (error) {
      if (gen === this.startGen) {
        this.state = 'idle';
        this.releaseStream();
      }
      throw CameraError.from(error);
    }
    // Superseded during attach: whoever bumped the generation already
    // released this.stream (stop/destroy) or took it over (a new acquisition).
    if (gen !== this.startGen) return;

    this.frameSource ??= this.internals.createFrameSource(this.video);
    this.runner ??= this.internals.createRunner(
      this.options.useWorker,
      this.options.useNativeDetector,
    );
    if (this.options.pauseOnHidden && typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', this.onVisibilityChange);
    }
    this.state = 'scanning';
    this.deduper.reset();
    this.assembler.reset();
    this.emit('start', undefined);
    // A pause() (or resume()) issued while we were 'starting' is applied now
    // that scanning has actually begun, so an initial suspend lands.
    if (this.pendingPause) {
      this.pendingPause = false;
      this.pause();
      return;
    }
    this.scheduleNext();
  }

  /** Stops scanning and releases the camera. */
  stop(): void {
    if (this.state === 'idle' || this.state === 'destroyed') return;
    this.startGen++; // invalidate any in-flight stream acquisition
    this.pendingPause = false;
    this.cancelLoop();
    this.releaseStream();
    if (typeof document !== 'undefined') {
      document.removeEventListener('visibilitychange', this.onVisibilityChange);
    }
    this.state = 'idle';
    this.emit('stop', undefined);
  }

  /** Suspends decoding but keeps the camera stream alive. */
  pause(): void {
    // A pause requested mid-startup is remembered and honored once start()
    // reaches 'scanning' — otherwise the initial suspend would silently no-op.
    if (this.state === 'starting') {
      this.pendingPause = true;
      return;
    }
    if (this.state !== 'scanning') return;
    this.cancelLoop();
    this.state = 'paused';
  }

  /** Resumes decoding after pause(). */
  resume(): void {
    // Mirror pause(): a resume during startup cancels a pending initial pause.
    if (this.state === 'starting') {
      this.pendingPause = false;
      return;
    }
    if (this.state !== 'paused') return;
    this.state = 'scanning';
    this.scheduleNext();
  }

  /** Full teardown; the instance cannot be reused afterwards. */
  destroy(): void {
    this.stop();
    this.startGen++; // stop() no-ops from 'idle'; in-flight acquisitions must still die
    this.runner?.destroy();
    this.runner = null;
    this.frameSource?.destroy();
    this.frameSource = null;
    this.listeners.clear();
    this.state = 'destroyed';
  }

  /** Switches cameras (facing mode or explicit device) without stopping. */
  async setCamera(camera: CameraOptions): Promise<void> {
    if (this.state === 'destroyed') throw new Error('scanner was destroyed');
    this.options.camera = camera;
    if (!this.stream) return;
    const wasScanning = this.state === 'scanning';
    this.cancelLoop();
    this.releaseStream();
    const gen = ++this.startGen;
    try {
      const stream = await startStream(camera, this.internals.mediaDevices);
      if (gen !== this.startGen) {
        // destroy()/stop() during the switch: the replacement stream has no
        // owner — release it and leave the teardown in place.
        stopStream(stream);
        return;
      }
      this.stream = stream;
      await this.attachStream();
    } catch (error) {
      // The old stream is already gone; a half-switched scanner would report
      // 'scanning' with no camera and no loop, so tear down cleanly instead.
      if (gen === this.startGen) this.stop();
      throw CameraError.from(error);
    }
    if (gen !== this.startGen) return;
    if (wasScanning) {
      this.state = 'scanning';
      this.scheduleNext();
    }
  }

  /** True if the torch was toggled; false when unsupported. */
  async setTorch(on: boolean): Promise<boolean> {
    const track = this.videoTrack();
    return track ? applyTorch(track, on) : false;
  }

  /** True if zoom was applied (clamped to range); false when unsupported. */
  async setZoom(zoom: number): Promise<boolean> {
    const track = this.videoTrack();
    return track ? applyZoom(track, zoom) : false;
  }

  getCapabilities(): CameraCapabilities {
    const track = this.videoTrack();
    return track ? getTrackCapabilities(track) : { torch: false, zoom: null };
  }

  /** Adjusts runtime options without restarting the camera. */
  update(options: QrScannerUpdate): void {
    if (options.maxScansPerSecond !== undefined) {
      this.options.maxScansPerSecond = options.maxScansPerSecond;
    }
    if ('scanRegion' in options) this.options.scanRegion = options.scanRegion;
    if (options.tryInverted !== undefined) this.options.tryInverted = options.tryInverted;
    if (options.tryHarder !== undefined) this.options.tryHarder = options.tryHarder;
    if (options.maxDownscale !== undefined) this.options.maxDownscale = options.maxDownscale;
    if (options.dedupeWindowMs !== undefined) {
      this.options.dedupeWindowMs = options.dedupeWindowMs;
      this.deduper.setWindow(options.dedupeWindowMs);
    }
    if (options.stopOnDecode !== undefined) this.options.stopOnDecode = options.stopOnDecode;
    if (options.multiple !== undefined) this.options.multiple = options.multiple;
    if (options.structuredAppend !== undefined) {
      this.options.structuredAppend = options.structuredAppend;
    }
  }

  on<E extends keyof ScannerEventMap>(
    event: E,
    listener: (payload: ScannerEventMap[E]) => void,
  ): void {
    let set = this.listeners.get(event);
    if (!set) {
      set = new Set();
      this.listeners.set(event, set);
    }
    set.add(listener as (payload: never) => void);
  }

  off<E extends keyof ScannerEventMap>(
    event: E,
    listener: (payload: ScannerEventMap[E]) => void,
  ): void {
    this.listeners.get(event)?.delete(listener as (payload: never) => void);
  }

  private emit<E extends keyof ScannerEventMap>(event: E, payload: ScannerEventMap[E]): void {
    const set = this.listeners.get(event);
    if (!set) return;
    for (const listener of set) {
      (listener as (p: ScannerEventMap[E]) => void)(payload);
    }
  }

  private async attachStream(): Promise<void> {
    // playsinline + muted are required for autoplay on iOS Safari.
    this.video.muted = true;
    if (typeof this.video.setAttribute === 'function') {
      this.video.setAttribute('playsinline', '');
    }
    this.video.srcObject = this.stream;
    await this.video.play();
  }

  private releaseStream(): void {
    if (this.stream) {
      stopStream(this.stream);
      this.stream = null;
    }
    this.video.srcObject = null;
  }

  private videoTrack(): MediaStreamTrack | null {
    return this.stream?.getVideoTracks()[0] ?? null;
  }

  private cancelLoop(): void {
    this.cancelTick?.();
    this.cancelTick = null;
  }

  private scheduleNext(): void {
    if (this.state !== 'scanning') return;
    this.cancelTick = this.internals.schedule(this.video, () => {
      void this.tick();
    });
  }

  private async tick(): Promise<void> {
    if (this.state !== 'scanning') return;
    const now = this.internals.now();
    const interval = 1000 / this.options.maxScansPerSecond;
    if (this.decoding || now - this.lastDecodeAt < interval) {
      this.scheduleNext();
      return;
    }

    const region = this.resolveRegion();
    const frame = this.frameSource?.grab(region) ?? null;
    if (!frame) {
      this.scheduleNext();
      return;
    }

    this.lastDecodeAt = now;
    this.decoding = true;
    try {
      const scan = await this.runner!.scan(frame, {
        tryInverted: this.options.tryInverted,
        tryHarder: this.options.tryHarder,
        maxDownscale: this.options.maxDownscale,
        multiple: this.options.multiple,
      });
      if (this.state === 'scanning') {
        if (region) {
          for (const item of [...scan.results, ...scan.detections]) {
            for (const point of item.cornerPoints) {
              point.x += region.x;
              point.y += region.y;
            }
          }
        }
        this.emit('detect', scan.detections.length > 0 ? scan.detections : null);
        for (const result of scan.results) {
          const emitted =
            result.structuredAppend && this.options.structuredAppend === 'reassemble'
              ? this.assembler.add(result, this.internals.now())
              : result;
          if (!emitted) continue;
          if (!this.deduper.shouldEmit(emitted.text, this.internals.now())) continue;
          this.emit('decode', emitted);
          if (this.options.stopOnDecode) {
            this.decoding = false;
            this.stop();
            return;
          }
        }
      }
    } catch (error) {
      // A throw here comes from the decode runner (a frame that failed to
      // decode, or the Web Worker crashing) — not the camera stream, so it
      // surfaces as a DecodeError rather than being mislabeled stream-failed.
      this.emit('error', DecodeError.from(error));
    } finally {
      this.decoding = false;
    }
    this.scheduleNext();
  }

  private resolveRegion(): Region | undefined {
    const { scanRegion } = this.options;
    if (!scanRegion) return undefined;
    return typeof scanRegion === 'function' ? scanRegion(this.video) : scanRegion;
  }
}

/** requestVideoFrameCallback → requestAnimationFrame → setTimeout. */
function defaultSchedule(video: HTMLVideoElement, callback: () => void): () => void {
  const withRvfc = video as HTMLVideoElement & {
    requestVideoFrameCallback?: (cb: () => void) => number;
    cancelVideoFrameCallback?: (id: number) => void;
  };
  if (typeof withRvfc.requestVideoFrameCallback === 'function') {
    const id = withRvfc.requestVideoFrameCallback(callback);
    return () => withRvfc.cancelVideoFrameCallback?.(id);
  }
  if (typeof requestAnimationFrame === 'function') {
    const id = requestAnimationFrame(callback);
    return () => cancelAnimationFrame(id);
  }
  const id = setTimeout(callback, 16);
  return () => clearTimeout(id);
}
