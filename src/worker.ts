/**
 * Decode worker entry point (built to dist/worker.js). Receives frames as
 * transferable buffers, runs the full detect+decode pipeline off the main
 * thread, and posts results + detection candidates back keyed by request id.
 */
import { type ScanFrameOptions, scanFrame } from './decode.js';

interface WorkerRequest {
  id: number;
  buffer: ArrayBuffer;
  width: number;
  height: number;
  options: ScanFrameOptions;
}

const scope = self as unknown as {
  onmessage: ((event: MessageEvent<WorkerRequest>) => void) | null;
  postMessage(message: unknown): void;
};

scope.onmessage = (event) => {
  const { id, buffer, width, height, options } = event.data;
  try {
    const scan = scanFrame({ data: new Uint8ClampedArray(buffer), width, height }, options);
    scope.postMessage({ id, results: scan.results, detections: scan.detections });
  } catch (error) {
    scope.postMessage({ id, error: error instanceof Error ? error.message : String(error) });
  }
};
