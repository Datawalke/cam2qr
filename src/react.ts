/**
 * React adapter (`cam2qr/react`): a hook that owns a QrScanner's lifecycle.
 * React is an optional peer dependency — this entry point is only bundled
 * when imported.
 */
import { useEffect, useRef, useState } from 'react';
import {
  QrScanner,
  type QrScannerOptions,
  type ScannerError,
  type ScannerInternals,
} from './scanner/scanner.js';
import type { QrResult } from './types.js';

export interface UseQrScannerOptions extends QrScannerOptions {
  /** Set false to keep the camera off (and release it). Default true. */
  enabled?: boolean;
  /**
   * Suspend/resume decoding while keeping the camera stream warm (no
   * black-flash or permission churn — distinct from `enabled`, which releases
   * the camera). Reactive: toggling it calls `pause()`/`resume()` on the live
   * scanner. `paused: true` from the first render starts suspended and lands
   * even during the async camera-startup window.
   */
  paused?: boolean;
}

export interface UseQrScannerReturn {
  /** Attach to the <video> element: `<video ref={videoRef} />`. */
  videoRef: (video: HTMLVideoElement | null) => void;
  /** Latest decoded result (state, re-renders on change). */
  result: QrResult | null;
  /** Latest camera/decode error, including start() failures. */
  error: ScannerError | null;
  /** True between the scanner's start and stop events. */
  isScanning: boolean;
  /** The underlying scanner for imperative control (torch, setCamera, …). */
  scanner: QrScanner | null;
}

/**
 * Starts scanning as soon as a video element is attached (and `enabled` is
 * not false); stops and releases the camera on unmount or when disabled.
 * Toggling `paused` suspends/resumes decoding without touching the camera.
 * Option changes other than `enabled`/`paused` do not restart the camera —
 * they are captured at scanner creation; use `scanner.update()` for live
 * tuning.
 */
export function useQrScanner(
  options: UseQrScannerOptions = {},
  internals?: ScannerInternals,
): UseQrScannerReturn {
  const [video, setVideo] = useState<HTMLVideoElement | null>(null);
  const [result, setResult] = useState<QrResult | null>(null);
  const [error, setError] = useState<ScannerError | null>(null);
  const [isScanning, setIsScanning] = useState(false);
  const [scanner, setScanner] = useState<QrScanner | null>(null);

  const optionsRef = useRef(options);
  optionsRef.current = options;
  const enabled = options.enabled !== false;
  const paused = options.paused === true;

  useEffect(() => {
    if (!video || !enabled) return undefined;
    const instance = new QrScanner(
      video,
      {
        ...optionsRef.current,
        onDecode(decodeResult) {
          setResult(decodeResult);
          optionsRef.current.onDecode?.(decodeResult);
        },
        onError(scanError) {
          setError(scanError);
          optionsRef.current.onError?.(scanError);
        },
      },
      internals,
    );
    instance.on('start', () => setIsScanning(true));
    instance.on('stop', () => setIsScanning(false));
    setScanner(instance);
    instance.start().catch((startError: ScannerError) => setError(startError));
    // Honor an initial paused intent; QrScanner remembers a pause requested
    // during the async 'starting' window and applies it once scanning begins.
    if (optionsRef.current.paused === true) instance.pause();
    return () => {
      instance.destroy();
      setScanner(null);
      setIsScanning(false);
    };
  }, [video, enabled, internals]);

  // Reactive pause/resume on the live scanner — keeps the stream warm.
  useEffect(() => {
    if (!scanner) return;
    if (paused) scanner.pause();
    else scanner.resume();
  }, [scanner, paused]);

  return { videoRef: setVideo, result, error, isScanning, scanner };
}
