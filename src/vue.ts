/**
 * Vue adapter (`cam2qr/vue`): a composable that owns a QrScanner's lifecycle.
 * Vue is an optional peer dependency — this entry point is only bundled when
 * imported. Call inside setup() (or an effect scope) so teardown runs.
 */
import {
  type Ref,
  type ShallowRef,
  computed,
  getCurrentScope,
  onScopeDispose,
  shallowRef,
  unref,
  watch,
} from 'vue';
import {
  QrScanner,
  type QrScannerOptions,
  type ScannerError,
  type ScannerInternals,
} from './scanner/scanner.js';
import type { QrResult } from './types.js';

export interface UseQrScannerOptions extends QrScannerOptions {
  /**
   * Set false to keep the camera off (and release it). Default true.
   * Pass a Ref to toggle reactively.
   */
  enabled?: boolean | Ref<boolean>;
  /**
   * Suspend/resume decoding while keeping the camera stream warm (distinct
   * from `enabled`, which releases it — no black-flash or permission churn).
   * Pass a Ref to toggle reactively. `true` from the start comes up suspended,
   * even through the async camera-startup window.
   */
  paused?: boolean | Ref<boolean>;
}

export interface UseQrScannerReturn {
  /** Bind to the <video> element: `<video ref="videoRef" />`. */
  videoRef: ShallowRef<HTMLVideoElement | null>;
  /** Latest decoded result. */
  result: ShallowRef<QrResult | null>;
  /** Latest camera/decode error, including start() failures. */
  error: ShallowRef<ScannerError | null>;
  /** True between the scanner's start and stop events. */
  isScanning: ShallowRef<boolean>;
  /** The underlying scanner for imperative control (torch, setCamera, …). */
  scanner: ShallowRef<QrScanner | null>;
}

/**
 * Starts scanning as soon as a video element is bound (and `enabled` is not
 * false); stops and releases the camera when the scope is disposed or when
 * disabled. Toggling `paused` suspends/resumes decoding without touching the
 * camera. Option changes other than `enabled`/`paused` do not restart the
 * camera — they are captured at scanner creation; use `scanner.value.update()`
 * for live tuning.
 */
export function useQrScanner(
  options: UseQrScannerOptions = {},
  internals?: ScannerInternals,
): UseQrScannerReturn {
  const videoRef = shallowRef<HTMLVideoElement | null>(null);
  const result = shallowRef<QrResult | null>(null);
  const error = shallowRef<ScannerError | null>(null);
  const isScanning = shallowRef(false);
  const scanner = shallowRef<QrScanner | null>(null);
  const enabled = computed(() => unref(options.enabled) !== false);
  const paused = computed(() => unref(options.paused) === true);

  let instance: QrScanner | null = null;
  const teardown = (): void => {
    instance?.destroy();
    instance = null;
    scanner.value = null;
    isScanning.value = false;
  };

  watch(
    [videoRef, enabled] as const,
    ([video, on]) => {
      teardown();
      if (!video || !on) return;
      instance = new QrScanner(
        video,
        {
          ...options,
          onDecode(decodeResult) {
            result.value = decodeResult;
            options.onDecode?.(decodeResult);
          },
          onError(scanError) {
            error.value = scanError;
            options.onError?.(scanError);
          },
        },
        internals,
      );
      instance.on('start', () => {
        isScanning.value = true;
      });
      instance.on('stop', () => {
        isScanning.value = false;
      });
      scanner.value = instance;
      instance.start().catch((startError: ScannerError) => {
        error.value = startError;
      });
      // Honor an initial paused intent; QrScanner remembers a pause requested
      // during the async 'starting' window and applies it once scanning begins.
      if (paused.value) instance.pause();
    },
    { immediate: true },
  );
  // Reactive pause/resume on the live scanner — keeps the stream warm.
  watch(paused, (isPaused) => {
    if (!instance) return;
    if (isPaused) instance.pause();
    else instance.resume();
  });
  if (getCurrentScope()) onScopeDispose(teardown);

  return { videoRef, result, error, isScanning, scanner };
}
