import { scanFrame } from './chunk-FFVNZWKB.js';

// src/worker.ts
var scope = self;
scope.onmessage = (event) => {
  const { id, buffer, width, height, options } = event.data;
  try {
    const scan = scanFrame({ data: new Uint8ClampedArray(buffer), width, height }, options);
    scope.postMessage({ id, results: scan.results, detections: scan.detections });
  } catch (error) {
    scope.postMessage({ id, error: error instanceof Error ? error.message : String(error) });
  }
};
//# sourceMappingURL=worker.js.map
//# sourceMappingURL=worker.js.map