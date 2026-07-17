/**
 * Svelte adapter (`cam2qr/svelte`): readable stores plus an action that own
 * a QrScanner's lifecycle. Uses only `svelte/store`, so it works across
 * Svelte 3, 4, and 5. Svelte is an optional peer dependency — this entry
 * point is only bundled when imported.
 */
import { type Readable, writable } from 'svelte/store';
import {
  QrScanner,
  type QrScannerOptions,
  type ScannerError,
  type ScannerInternals,
} from './scanner/scanner.js';
import type { QrResult } from './types.js';

export interface CreateQrScannerOptions extends QrScannerOptions {
  /**
   * Suspend/resume decoding while keeping the camera stream warm — distinct
   * from unmounting the `<video>`, which releases the camera (no black-flash
   * or permission churn). Pass a boolean, or a store to toggle reactively; a
   * `true` value comes up suspended even through the async camera-startup
   * window.
   */
  paused?: boolean | Readable<boolean>;
}

export interface QrScannerStores {
  /**
   * Svelte action: `<video use:video />`. Starts the camera on mount and
   * releases it on destroy — gate mounting (`{#if enabled}`) to toggle.
   */
  video: (node: HTMLVideoElement) => { destroy(): void };
  /** Latest decoded result. */
  result: Readable<QrResult | null>;
  /** Latest camera/decode error, including start() failures. */
  error: Readable<ScannerError | null>;
  /** True between the scanner's start and stop events. */
  isScanning: Readable<boolean>;
  /** The underlying scanner while a video is mounted, else null. */
  scanner: Readable<QrScanner | null>;
}

/**
 * ```svelte
 * <script>
 *   import { createQrScanner } from 'cam2qr/svelte';
 *   const { video, result } = createQrScanner({ onDecode: (r) => console.log(r.text) });
 * </script>
 * <video use:video></video>
 * {#if $result}<p>{$result.text}</p>{/if}
 * ```
 */
export function createQrScanner(
  options: CreateQrScannerOptions = {},
  internals?: ScannerInternals,
): QrScannerStores {
  const result = writable<QrResult | null>(null);
  const error = writable<ScannerError | null>(null);
  const isScanning = writable(false);
  const scanner = writable<QrScanner | null>(null);

  return {
    result: { subscribe: result.subscribe },
    error: { subscribe: error.subscribe },
    isScanning: { subscribe: isScanning.subscribe },
    scanner: { subscribe: scanner.subscribe },
    video(node: HTMLVideoElement) {
      const instance = new QrScanner(
        node,
        {
          ...options,
          onDecode(decodeResult) {
            result.set(decodeResult);
            options.onDecode?.(decodeResult);
          },
          onError(scanError) {
            error.set(scanError);
            options.onError?.(scanError);
          },
        },
        internals,
      );
      instance.on('start', () => isScanning.set(true));
      instance.on('stop', () => isScanning.set(false));
      scanner.set(instance);
      instance.start().catch((startError: ScannerError) => error.set(startError));
      // Suspend/resume without releasing the camera. A store toggles reactively
      // (its immediate subscription fires now); QrScanner remembers a pause
      // requested during the async 'starting' window and honors it at start.
      const unsubscribePaused = subscribePaused(options.paused, (isPaused) => {
        if (isPaused) instance.pause();
        else instance.resume();
      });
      return {
        destroy(): void {
          unsubscribePaused?.();
          instance.destroy();
          scanner.set(null);
          isScanning.set(false);
        },
      };
    },
  };
}

/**
 * Applies a `paused` intent that may be a static boolean or a reactive store.
 * A store subscription runs its callback immediately with the current value,
 * then on every change; returns an unsubscribe for stores, or undefined for a
 * static boolean (which is applied once, right away).
 */
function subscribePaused(
  paused: boolean | Readable<boolean> | undefined,
  apply: (isPaused: boolean) => void,
): (() => void) | undefined {
  if (isReadable(paused)) return paused.subscribe((value) => apply(value === true));
  if (paused === true) apply(true);
  return undefined;
}

function isReadable(value: unknown): value is Readable<boolean> {
  return typeof (value as { subscribe?: unknown } | null)?.subscribe === 'function';
}
