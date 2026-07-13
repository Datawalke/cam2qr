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
    if (worker) return createWorkerRunner(worker);
  }
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

function createWorkerRunner(worker: Worker): DecodeRunner {
  let nextId = 0;
  const pending = new Map<
    number,
    { resolve: (r: FrameScan) => void; reject: (e: Error) => void }
  >();

  worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
    const { id, results, detections, error } = event.data;
    const entry = pending.get(id);
    if (!entry) return;
    pending.delete(id);
    if (error !== undefined) entry.reject(new Error(error));
    else entry.resolve({ results: results ?? [], detections: detections ?? [] });
  };
  worker.onerror = () => {
    const entries = [...pending.values()];
    pending.clear();
    for (const entry of entries) entry.reject(new Error('decode worker crashed'));
  };

  return {
    scan(image, options): Promise<FrameScan> {
      const id = nextId++;
      // Copy into a transferable buffer: the caller's frame may be reused.
      const buffer = new Uint8ClampedArray(image.data).buffer;
      return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject });
        worker.postMessage({ id, buffer, width: image.width, height: image.height, options }, [
          buffer,
        ]);
      });
    },
    destroy(): void {
      worker.terminate();
      pending.clear();
    },
  };
}
