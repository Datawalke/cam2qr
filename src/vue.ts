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
import type { CameraError } from './camera/errors.js';
import { QrScanner, type QrScannerOptions, type ScannerInternals } from './scanner/scanner.js';
import type { QrResult } from './types.js';

export interface UseQrScannerOptions extends QrScannerOptions {
  /**
   * Set false to keep the camera off (and release it). Default true.
   * Pass a Ref to toggle reactively.
   */
  enabled?: boolean | Ref<boolean>;
}

export interface UseQrScannerReturn {
  /** Bind to the <video> element: `<video ref="videoRef" />`. */
  videoRef: ShallowRef<HTMLVideoElement | null>;
  /** Latest decoded result. */
  result: ShallowRef<QrResult | null>;
  /** Latest camera/decode error, including start() failures. */
  error: ShallowRef<CameraError | null>;
  /** True between the scanner's start and stop events. */
  isScanning: ShallowRef<boolean>;
  /** The underlying scanner for imperative control (torch, setCamera, …). */
  scanner: ShallowRef<QrScanner | null>;
}

/**
 * Starts scanning as soon as a video element is bound (and `enabled` is not
 * false); stops and releases the camera when the scope is disposed or when
 * disabled. Non-`enabled` option changes do not restart the camera — they
 * are captured at scanner creation; use `scanner.value.update()` for live
 * tuning.
 */
export function useQrScanner(
  options: UseQrScannerOptions = {},
  internals?: ScannerInternals,
): UseQrScannerReturn {
  const videoRef = shallowRef<HTMLVideoElement | null>(null);
  const result = shallowRef<QrResult | null>(null);
  const error = shallowRef<CameraError | null>(null);
  const isScanning = shallowRef(false);
  const scanner = shallowRef<QrScanner | null>(null);
  const enabled = computed(() => unref(options.enabled) !== false);

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
      instance.start().catch((startError: CameraError) => {
        error.value = startError;
      });
    },
    { immediate: true },
  );
  if (getCurrentScope()) onScopeDispose(teardown);

  return { videoRef, result, error, isScanning, scanner };
}
