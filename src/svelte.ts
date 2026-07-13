/**
 * Svelte adapter (`cam2qr/svelte`): readable stores plus an action that own
 * a QrScanner's lifecycle. Uses only `svelte/store`, so it works across
 * Svelte 3, 4, and 5. Svelte is an optional peer dependency — this entry
 * point is only bundled when imported.
 */
import { type Readable, writable } from 'svelte/store';
import type { CameraError } from './camera/errors.js';
import { QrScanner, type QrScannerOptions, type ScannerInternals } from './scanner/scanner.js';
import type { QrResult } from './types.js';

export interface QrScannerStores {
  /**
   * Svelte action: `<video use:video />`. Starts the camera on mount and
   * releases it on destroy — gate mounting (`{#if enabled}`) to toggle.
   */
  video: (node: HTMLVideoElement) => { destroy(): void };
  /** Latest decoded result. */
  result: Readable<QrResult | null>;
  /** Latest camera/decode error, including start() failures. */
  error: Readable<CameraError | null>;
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
  options: QrScannerOptions = {},
  internals?: ScannerInternals,
): QrScannerStores {
  const result = writable<QrResult | null>(null);
  const error = writable<CameraError | null>(null);
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
      instance.start().catch((startError: CameraError) => error.set(startError));
      return {
        destroy(): void {
          instance.destroy();
          scanner.set(null);
          isScanning.set(false);
        },
      };
    },
  };
}
