/**
 * React adapter (`cam2qr/react`): a hook that owns a QrScanner's lifecycle.
 * React is an optional peer dependency — this entry point is only bundled
 * when imported.
 */
import { useEffect, useRef, useState } from 'react';
import type { CameraError } from './camera/errors.js';
import { QrScanner, type QrScannerOptions, type ScannerInternals } from './scanner/scanner.js';
import type { QrResult } from './types.js';

export interface UseQrScannerOptions extends QrScannerOptions {
  /** Set false to keep the camera off (and release it). Default true. */
  enabled?: boolean;
}

export interface UseQrScannerReturn {
  /** Attach to the <video> element: `<video ref={videoRef} />`. */
  videoRef: (video: HTMLVideoElement | null) => void;
  /** Latest decoded result (state, re-renders on change). */
  result: QrResult | null;
  /** Latest camera/decode error, including start() failures. */
  error: CameraError | null;
  /** True between the scanner's start and stop events. */
  isScanning: boolean;
  /** The underlying scanner for imperative control (torch, setCamera, …). */
  scanner: QrScanner | null;
}

/**
 * Starts scanning as soon as a video element is attached (and `enabled` is
 * not false); stops and releases the camera on unmount or when disabled.
 * Option changes other than `enabled` do not restart the camera — they are
 * captured at scanner creation; use `scanner.update()` for live tuning.
 */
export function useQrScanner(
  options: UseQrScannerOptions = {},
  internals?: ScannerInternals,
): UseQrScannerReturn {
  const [video, setVideo] = useState<HTMLVideoElement | null>(null);
  const [result, setResult] = useState<QrResult | null>(null);
  const [error, setError] = useState<CameraError | null>(null);
  const [isScanning, setIsScanning] = useState(false);
  const [scanner, setScanner] = useState<QrScanner | null>(null);

  const optionsRef = useRef(options);
  optionsRef.current = options;
  const enabled = options.enabled !== false;

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
    instance.start().catch((startError: CameraError) => setError(startError));
    return () => {
      instance.destroy();
      setScanner(null);
      setIsScanning(false);
    };
  }, [video, enabled, internals]);

  return { videoRef: setVideo, result, error, isScanning, scanner };
}
