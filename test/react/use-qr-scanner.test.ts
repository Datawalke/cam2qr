// @vitest-environment happy-dom
import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { useQrScanner } from '../../src/react.js';
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

describe('useQrScanner', () => {
  it('starts scanning when a video element attaches and surfaces results', async () => {
    const harness = makeHarness('react hook test');
    const { result, unmount } = renderHook(() => useQrScanner({}, harness.internals));

    expect(result.current.scanner).toBeNull();
    act(() => result.current.videoRef(harness.video));
    await waitFor(() => expect(result.current.isScanning).toBe(true));

    await act(() => harness.loop.runTick());
    await waitFor(() => expect(result.current.result?.text).toBe('react hook test'));

    unmount();
    expect(harness.track.stop).toHaveBeenCalled();
  });

  it('enabled: false keeps the camera off; enabling starts it', async () => {
    const harness = makeHarness('toggle');
    const { result, rerender, unmount } = renderHook(
      ({ enabled }: { enabled: boolean }) => useQrScanner({ enabled }, harness.internals),
      { initialProps: { enabled: false } },
    );

    act(() => result.current.videoRef(harness.video));
    expect(result.current.isScanning).toBe(false);
    expect(result.current.scanner).toBeNull();

    rerender({ enabled: true });
    await waitFor(() => expect(result.current.isScanning).toBe(true));

    rerender({ enabled: false });
    await waitFor(() => expect(result.current.isScanning).toBe(false));
    expect(harness.track.stop).toHaveBeenCalled();
    unmount();
  });

  it('surfaces start() failures as error state', async () => {
    const failing = makeManualInternals({
      mediaDevices: {
        getUserMedia: async () => {
          throw { name: 'NotAllowedError', message: 'denied' };
        },
      } as unknown as MediaDevices,
    });
    const { result, unmount } = renderHook(() => useQrScanner({}, failing.internals));
    act(() => result.current.videoRef(makeFakeVideo()));
    await waitFor(() => expect(result.current.error?.code).toBe('permission-denied'));
    expect(result.current.isScanning).toBe(false);
    unmount();
  });
});
