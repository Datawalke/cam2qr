import { type FrameScan, type ScanFrameOptions, scanFrame } from '../decode.js';
import type { ImageDataLike } from '../types.js';
import { tryCreateNativeRunner } from './native.js';

/** Executes frame scans, on a worker or inline; a scanner-internal seam. */
export interface DecodeRunner {
  scan(image: ImageDataLike, options: ScanFrameOptions): Promise<FrameScan>;
  destroy(): void;
}

interface WorkerResponse {
  id: number;
  results?: FrameScan['results'];
  detections?: FrameScan['detections'];
  error?: string;
}

/**
 * Prefers a module worker (decoding off the main thread) and falls back to
 * inline decoding wherever workers aren't available (Node, old browsers,
 * CJS bundles without import.meta support). With useNativeDetector, the
 * browser's BarcodeDetector runs first and hands over to our engine when
 * missing or failing (see native.ts).
 */
export function createDecodeRunner(useWorker: boolean, useNativeDetector = false): DecodeRunner {
  const engine = () => createEngineRunner(useWorker);
  if (useNativeDetector) {
    const native = tryCreateNativeRunner(engine);
    if (native) return native;
  }
  return engine();
}

function createEngineRunner(useWorker: boolean): DecodeRunner {
  if (useWorker) {
    const worker = tryCreateWorker();
    if (worker) return createWorkerRunner(worker, createInlineRunner);
  }
  return createInlineRunner();
}

/** Synchronous, main-thread decode — the always-available fallback. */
function createInlineRunner(): DecodeRunner {
  return {
    scan: (image, options) => Promise.resolve(scanFrame(image, options)),
    destroy(): void {},
  };
}

function tryCreateWorker(): Worker | null {
  try {
    if (typeof Worker === 'undefined') return null;
    // Bundlers (Vite, webpack, …) statically recognize this exact pattern
    // and take care of serving the worker chunk.
    return new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
  } catch {
    return null;
  }
}

/**
 * Runs scans on a module worker, but self-heals: if the worker fails at
 * runtime (`onerror` — a 404 on the chunk, a CSP block, an offline
 * precache miss), it terminates the worker and permanently hands over to the
 * inline engine, re-running any in-flight scans there instead of rejecting
 * them forever. This mirrors the native-detector fallback in native.ts, so a
 * scanner started with useWorker never gets stuck emitting errors.
 */
function createWorkerRunner(worker: Worker, fallback: () => DecodeRunner): DecodeRunner {
  let nextId = 0;
  const pending = new Map<
    number,
    {
      image: ImageDataLike;
      options: ScanFrameOptions;
      resolve: (r: FrameScan) => void;
      reject: (e: Error) => void;
    }
  >();
  let inline: DecodeRunner | null = null;

  worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
    const { id, results, detections, error } = event.data;
    const entry = pending.get(id);
    if (!entry) return;
    pending.delete(id);
    // A per-message `error` is the worker reporting a single frame threw — a
    // decode fault, not a worker failure. Reject so it surfaces like the inline
    // engine's throw would; it does not trigger the self-heal fallback.
    if (error !== undefined) entry.reject(new Error(error));
    else entry.resolve({ results: results ?? [], detections: detections ?? [] });
  };
  worker.onerror = () => {
    if (inline) return;
    // The worker itself died: switch to the inline engine and rescue every
    // in-flight scan by re-running it there instead of rejecting it.
    inline = fallback();
    worker.terminate();
    const inflight = [...pending.values()];
    pending.clear();
    for (const entry of inflight) {
      inline.scan(entry.image, entry.options).then(entry.resolve, entry.reject);
    }
  };

  return {
    scan(image, options): Promise<FrameScan> {
      if (inline) return inline.scan(image, options);
      const id = nextId++;
      // Copy into a transferable buffer: the caller's frame may be reused.
      // The original `image` is kept intact so a self-heal can re-run inline.
      const buffer = new Uint8ClampedArray(image.data).buffer;
      return new Promise((resolve, reject) => {
        pending.set(id, { image, options, resolve, reject });
        worker.postMessage({ id, buffer, width: image.width, height: image.height, options }, [
          buffer,
        ]);
      });
    },
    destroy(): void {
      if (!inline) worker.terminate();
      inline?.destroy();
      pending.clear();
    },
  };
}
