import { describe, expect, it, vi } from 'vitest';
import { effectScope, shallowRef } from 'vue';
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
  return { ...harness, track, video: makeFakeVideo() };
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
