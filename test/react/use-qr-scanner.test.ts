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
  return { ...harness, track, mediaDevices, video: makeFakeVideo() };
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

  it('paused: true starts suspended even through the async startup window', async () => {
    const harness = makeHarness('start suspended');
    const { result, rerender, unmount } = renderHook(
      ({ paused }: { paused: boolean }) => useQrScanner({ paused }, harness.internals),
      { initialProps: { paused: true } },
    );

    act(() => result.current.videoRef(harness.video));
    // The stream comes up (isScanning), but decoding is suspended: no scan
    // loop is scheduled and no result arrives.
    await waitFor(() => expect(result.current.isScanning).toBe(true));
    expect(harness.loop.pendingTicks()).toBe(0);
    await act(() => harness.loop.runTick());
    expect(result.current.result).toBeNull();

    // Resuming decodes without ever having released the camera.
    rerender({ paused: false });
    await act(() => harness.loop.runTick());
    await waitFor(() => expect(result.current.result?.text).toBe('start suspended'));
    expect(harness.mediaDevices.getUserMedia).toHaveBeenCalledTimes(1);
    unmount();
  });

  it('toggling paused resumes/suspends without re-requesting the camera', async () => {
    const harness = makeHarness('warm stream');
    const { result, rerender, unmount } = renderHook(
      ({ paused }: { paused: boolean }) => useQrScanner({ paused }, harness.internals),
      { initialProps: { paused: false } },
    );

    act(() => result.current.videoRef(harness.video));
    await waitFor(() => expect(result.current.isScanning).toBe(true));
    await act(() => harness.loop.runTick());
    await waitFor(() => expect(result.current.result?.text).toBe('warm stream'));

    // Pause: the scan loop stops, but the stream stays live (no track.stop).
    rerender({ paused: true });
    await waitFor(() => expect(harness.loop.pendingTicks()).toBe(0));
    expect(harness.track.stop).not.toHaveBeenCalled();

    // Resume: scanning continues on the same camera.
    rerender({ paused: false });
    await act(() => harness.loop.runTick());
    expect(harness.mediaDevices.getUserMedia).toHaveBeenCalledTimes(1);
    expect(harness.track.stop).not.toHaveBeenCalled();
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
