import { afterEach, describe, expect, it, vi } from 'vitest';
import { createDecodeRunner } from '../../src/scanner/runner.js';
import type { ImageDataLike } from '../../src/types.js';
import { generate } from '../helpers/generate.js';
import { renderMatrix } from '../helpers/image.js';

function qrFrame(payload: string): ImageDataLike {
  return renderMatrix(generate(payload, { version: 2, level: 'M' }).matrix, {
    scale: 6,
    margin: 4,
  });
}

/**
 * A module worker that constructs fine but fails the first time it is asked to
 * do work — the 404/CSP/offline-precache case from issue #3, where the chunk
 * never loads so the runtime fires `onerror` rather than posting a result.
 */
class FailingWorker {
  static instances: FailingWorker[] = [];
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: unknown) => void) | null = null;
  terminated = false;

  constructor() {
    FailingWorker.instances.push(this);
  }

  postMessage(): void {
    // The worker chunk failed to load/execute: surface a runtime error the
    // way a real Worker does, asynchronously, with no matching onmessage.
    queueMicrotask(() => this.onerror?.({}));
  }

  terminate(): void {
    this.terminated = true;
  }
}

afterEach(() => {
  vi.unstubAllGlobals();
  FailingWorker.instances = [];
});

describe('decode worker runner self-heal', () => {
  it('falls back to the inline engine when the worker errors, resolving the in-flight scan', async () => {
    vi.stubGlobal('Worker', FailingWorker);

    const runner = createDecodeRunner(true);
    // The very first scan hits the dead worker; instead of rejecting forever it
    // recovers inline and returns a real decode.
    const first = await runner.scan(qrFrame('worker heals'), {});
    expect(first.results[0]?.text).toBe('worker heals');

    // The worker was torn down and never used again.
    expect(FailingWorker.instances).toHaveLength(1);
    expect(FailingWorker.instances[0]!.terminated).toBe(true);

    // Subsequent scans decode inline without touching the worker.
    const second = await runner.scan(qrFrame('still inline'), {});
    expect(second.results[0]?.text).toBe('still inline');

    runner.destroy();
  });

  it('rescues multiple scans that were in flight when the worker died', async () => {
    vi.stubGlobal('Worker', FailingWorker);

    const runner = createDecodeRunner(true);
    const [a, b] = await Promise.all([
      runner.scan(qrFrame('inflight one'), {}),
      runner.scan(qrFrame('inflight two'), {}),
    ]);
    expect(a.results[0]?.text).toBe('inflight one');
    expect(b.results[0]?.text).toBe('inflight two');
    // Only one worker was ever created, then abandoned.
    expect(FailingWorker.instances).toHaveLength(1);
    runner.destroy();
  });
});
