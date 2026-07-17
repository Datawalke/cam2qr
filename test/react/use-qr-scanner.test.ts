// @vitest-environment happy-dom
import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { useQrScanner } from '../../src/react.js';
import {
  makeDeferredMediaDevices,
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

  it('StrictMode-style remount during camera startup leaks no stream', async () => {
    // mount → unmount → remount with getUserMedia still pending, the exact
    // sequence React StrictMode produces on every dev mount. The first
    // mount's stream resolves into an already-destroyed scanner and must be
    // stopped; the remount's stream is the single live one.
    const deferred = makeDeferredMediaDevices();
    const video = makeFakeVideo();

    const harness1 = makeManualInternals({ mediaDevices: deferred.mediaDevices });
    const first = renderHook(() => useQrScanner({}, harness1.internals));
    act(() => first.result.current.videoRef(video));
    expect(deferred.pendingCount()).toBe(1);
    first.unmount(); // destroy() while getUserMedia is in flight

    const harness2 = makeManualInternals({ mediaDevices: deferred.mediaDevices });
    const second = renderHook(() => useQrScanner({}, harness2.internals));
    act(() => second.result.current.videoRef(video));
    expect(deferred.pendingCount()).toBe(2);

    const trackA = makeFakeTrack();
    const trackB = makeFakeTrack();
    await act(() => deferred.resolveNext(makeFakeStream(trackA)));
    await act(() => deferred.resolveNext(makeFakeStream(trackB)));

    expect(trackA.stop).toHaveBeenCalled(); // orphaned first-mount stream released
    expect(trackB.stop).not.toHaveBeenCalled();
    await waitFor(() => expect(second.result.current.isScanning).toBe(true));
    expect(second.result.current.scanner).not.toBeNull();

    second.unmount();
    expect(trackB.stop).toHaveBeenCalled(); // and the survivor still tears down
  });

  it('toggling enabled off during startup releases the pending stream', async () => {
    const deferred = makeDeferredMediaDevices();
    const video = makeFakeVideo();
    const harness = makeManualInternals({ mediaDevices: deferred.mediaDevices });
    const { result, rerender, unmount } = renderHook(
      ({ enabled }: { enabled: boolean }) => useQrScanner({ enabled }, harness.internals),
      { initialProps: { enabled: true } },
    );

    act(() => result.current.videoRef(video));
    rerender({ enabled: false }); // destroy() mid-acquisition
    const trackA = makeFakeTrack();
    await act(() => deferred.resolveNext(makeFakeStream(trackA)));
    expect(trackA.stop).toHaveBeenCalled();
    expect(result.current.isScanning).toBe(false);

    // Re-enabling reacquires cleanly on a fresh scanner.
    rerender({ enabled: true });
    const trackB = makeFakeTrack();
    await act(() => deferred.resolveNext(makeFakeStream(trackB)));
    await waitFor(() => expect(result.current.isScanning).toBe(true));
    expect(trackB.stop).not.toHaveBeenCalled();
    unmount();
    expect(trackB.stop).toHaveBeenCalled();
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
