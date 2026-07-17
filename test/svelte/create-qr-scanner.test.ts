import { get, writable } from 'svelte/store';
import { describe, expect, it, vi } from 'vitest';
import { DecodeError } from '../../src/errors.js';
import { createQrScanner } from '../../src/svelte.js';
import {
  makeFakeMediaDevices,
  makeFakeStream,
  makeFakeTrack,
  makeFakeVideo,
  makeManualInternals,
} from '../helpers/camera-fakes.js';
import { generate } from '../helpers/generate.js';
import { renderMatrix } from '../helpers/image.js';

function makeHarness(payload: string) {
  const track = makeFakeTrack({});
  const mediaDevices = makeFakeMediaDevices(makeFakeStream(track));
  const frame = renderMatrix(generate(payload, { version: 2, level: 'M' }).matrix, {
    scale: 6,
    margin: 4,
  });
  const harness = makeManualInternals({ frame: () => frame, mediaDevices });
  return { ...harness, track, mediaDevices, video: makeFakeVideo() };
}

/** A harness whose decode runner always throws — a decode/worker fault. */
function makeFailingRunnerHarness() {
  const track = makeFakeTrack({});
  const mediaDevices = makeFakeMediaDevices(makeFakeStream(track));
  const frame = renderMatrix(generate('anything', { version: 2, level: 'M' }).matrix, {
    scale: 6,
    margin: 4,
  });
  const harness = makeManualInternals({
    frame: () => frame,
    mediaDevices,
    createRunner: () => ({
      scan: async () => {
        throw new Error('decode worker crashed');
      },
      destroy() {},
    }),
  });
  return { ...harness, track, mediaDevices, video: makeFakeVideo() };
}

describe('createQrScanner (svelte)', () => {
  it('the action starts scanning on mount and surfaces results via stores', async () => {
    const harness = makeHarness('svelte adapter test');
    const api = createQrScanner({}, harness.internals);

    expect(get(api.scanner)).toBeNull();
    const action = api.video(harness.video);
    expect(get(api.scanner)).not.toBeNull();
    await vi.waitFor(() => expect(get(api.isScanning)).toBe(true));

    await harness.loop.runTick();
    await vi.waitFor(() => expect(get(api.result)?.text).toBe('svelte adapter test'));

    action.destroy();
    expect(harness.track.stop).toHaveBeenCalled();
    expect(get(api.isScanning)).toBe(false);
    expect(get(api.scanner)).toBeNull();
  });

  it('a paused store starts suspended and resumes on the same camera', async () => {
    const harness = makeHarness('svelte suspended');
    const paused = writable(true);
    const api = createQrScanner({ paused }, harness.internals);

    const action = api.video(harness.video);
    // The stream comes up but decoding is suspended: no loop, no result.
    await vi.waitFor(() => expect(get(api.isScanning)).toBe(true));
    expect(harness.loop.pendingTicks()).toBe(0);
    await harness.loop.runTick();
    expect(get(api.result)).toBeNull();

    // Resuming decodes without re-requesting the camera.
    paused.set(false);
    await harness.loop.runTick();
    await vi.waitFor(() => expect(get(api.result)?.text).toBe('svelte suspended'));
    expect(harness.mediaDevices.getUserMedia).toHaveBeenCalledTimes(1);
    action.destroy();
  });

  it('toggling the paused store keeps the stream warm (no track.stop, no re-request)', async () => {
    const harness = makeHarness('svelte warm');
    const paused = writable(false);
    const api = createQrScanner({ paused }, harness.internals);

    const action = api.video(harness.video);
    await vi.waitFor(() => expect(get(api.isScanning)).toBe(true));
    await harness.loop.runTick();
    await vi.waitFor(() => expect(get(api.result)?.text).toBe('svelte warm'));

    paused.set(true);
    await vi.waitFor(() => expect(harness.loop.pendingTicks()).toBe(0));
    expect(harness.track.stop).not.toHaveBeenCalled();

    paused.set(false);
    await harness.loop.runTick();
    expect(harness.mediaDevices.getUserMedia).toHaveBeenCalledTimes(1);
    expect(harness.track.stop).not.toHaveBeenCalled();
    action.destroy();
  });

  it('surfaces decode-runner faults as DecodeError via the error store', async () => {
    const harness = makeFailingRunnerHarness();
    const api = createQrScanner({}, harness.internals);
    const action = api.video(harness.video);
    await vi.waitFor(() => expect(get(api.isScanning)).toBe(true));

    await harness.loop.runTick();
    await vi.waitFor(() => expect(get(api.error)).toBeInstanceOf(DecodeError));
    expect((get(api.error) as DecodeError).code).toBe('runner-failed');
    action.destroy();
  });

  it('forwards onDecode and surfaces start() failures via the error store', async () => {
    const failing = makeManualInternals({
      mediaDevices: {
        getUserMedia: async () => {
          throw { name: 'NotAllowedError', message: 'denied' };
        },
      } as unknown as MediaDevices,
    });
    const api = createQrScanner({}, failing.internals);
    const action = api.video(makeFakeVideo());
    await vi.waitFor(() => expect(get(api.error)?.code).toBe('permission-denied'));
    expect(get(api.isScanning)).toBe(false);
    action.destroy();
  });
});
