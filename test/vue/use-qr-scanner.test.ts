import { describe, expect, it, vi } from 'vitest';
import { effectScope, nextTick, shallowRef } from 'vue';
import { DecodeError } from '../../src/errors.js';
import { useQrScanner } from '../../src/vue.js';
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

describe('useQrScanner (vue)', () => {
  it('starts scanning when a video element binds and surfaces results', async () => {
    const harness = makeHarness('vue composable test');
    const scope = effectScope();
    const api = scope.run(() => useQrScanner({}, harness.internals))!;

    expect(api.scanner.value).toBeNull();
    api.videoRef.value = harness.video;
    await vi.waitFor(() => expect(api.isScanning.value).toBe(true));

    await harness.loop.runTick();
    await vi.waitFor(() => expect(api.result.value?.text).toBe('vue composable test'));

    scope.stop();
    expect(harness.track.stop).toHaveBeenCalled();
    expect(api.isScanning.value).toBe(false);
  });

  it('enabled ref keeps the camera off and toggles it reactively', async () => {
    const harness = makeHarness('toggle');
    const enabled = shallowRef(false);
    const scope = effectScope();
    const api = scope.run(() => useQrScanner({ enabled }, harness.internals))!;

    api.videoRef.value = harness.video;
    await Promise.resolve();
    expect(api.isScanning.value).toBe(false);
    expect(api.scanner.value).toBeNull();

    enabled.value = true;
    await vi.waitFor(() => expect(api.isScanning.value).toBe(true));

    enabled.value = false;
    await vi.waitFor(() => expect(api.isScanning.value).toBe(false));
    expect(harness.track.stop).toHaveBeenCalled();
    scope.stop();
  });

  it('paused ref starts suspended and resumes on the same camera', async () => {
    const harness = makeHarness('vue suspended');
    const paused = shallowRef(true);
    const scope = effectScope();
    const api = scope.run(() => useQrScanner({ paused }, harness.internals))!;

    api.videoRef.value = harness.video;
    // The stream comes up but decoding is suspended: no loop, no result.
    await vi.waitFor(() => expect(api.isScanning.value).toBe(true));
    expect(harness.loop.pendingTicks()).toBe(0);
    await harness.loop.runTick();
    expect(api.result.value).toBeNull();

    // Resuming decodes without re-requesting the camera. nextTick() lets the
    // reactive watcher flush (Vue watchers run on the microtask queue) so
    // resume() has scheduled the next tick before we run it.
    paused.value = false;
    await nextTick();
    await harness.loop.runTick();
    await vi.waitFor(() => expect(api.result.value?.text).toBe('vue suspended'));
    expect(harness.mediaDevices.getUserMedia).toHaveBeenCalledTimes(1);
    scope.stop();
  });

  it('toggling paused keeps the stream warm (no track.stop, no re-request)', async () => {
    const harness = makeHarness('vue warm');
    const paused = shallowRef(false);
    const scope = effectScope();
    const api = scope.run(() => useQrScanner({ paused }, harness.internals))!;

    api.videoRef.value = harness.video;
    await vi.waitFor(() => expect(api.isScanning.value).toBe(true));
    await harness.loop.runTick();
    await vi.waitFor(() => expect(api.result.value?.text).toBe('vue warm'));

    paused.value = true;
    await vi.waitFor(() => expect(harness.loop.pendingTicks()).toBe(0));
    expect(harness.track.stop).not.toHaveBeenCalled();

    paused.value = false;
    await harness.loop.runTick();
    expect(harness.mediaDevices.getUserMedia).toHaveBeenCalledTimes(1);
    expect(harness.track.stop).not.toHaveBeenCalled();
    scope.stop();
  });

  it('surfaces decode-runner faults as DecodeError via the error store', async () => {
    const harness = makeFailingRunnerHarness();
    const scope = effectScope();
    const api = scope.run(() => useQrScanner({}, harness.internals))!;
    api.videoRef.value = harness.video;
    await vi.waitFor(() => expect(api.isScanning.value).toBe(true));

    await harness.loop.runTick();
    await vi.waitFor(() => expect(api.error.value).toBeInstanceOf(DecodeError));
    expect((api.error.value as DecodeError).code).toBe('runner-failed');
    scope.stop();
  });

  it('surfaces start() failures as error state', async () => {
    const failing = makeManualInternals({
      mediaDevices: {
        getUserMedia: async () => {
          throw { name: 'NotAllowedError', message: 'denied' };
        },
      } as unknown as MediaDevices,
    });
    const scope = effectScope();
    const api = scope.run(() => useQrScanner({}, failing.internals))!;
    api.videoRef.value = makeFakeVideo();
    await vi.waitFor(() => expect(api.error.value?.code).toBe('permission-denied'));
    expect(api.isScanning.value).toBe(false);
    scope.stop();
  });
});
