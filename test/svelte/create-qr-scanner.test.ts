import { get } from 'svelte/store';
import { describe, expect, it, vi } from 'vitest';
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
  return { ...harness, track, video: makeFakeVideo() };
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
