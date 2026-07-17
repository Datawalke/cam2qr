// @vitest-environment happy-dom
// Teardown racing the async camera acquisition: getUserMedia can take
// 100ms–seconds, and destroy()/stop() during that window must not leak the
// stream that eventually resolves or resurrect a torn-down scanner. This is
// React StrictMode's mount → unmount → remount pattern on every dev mount.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { QrScanner } from '../../src/scanner/scanner.js';
import {
  makeDeferredMediaDevices,
  makeFakeStream,
  makeFakeTrack,
  makeFakeVideo,
  makeManualInternals,
} from '../helpers/camera-fakes.js';

function makeRacyScanner() {
  const deferred = makeDeferredMediaDevices();
  const video = makeFakeVideo();
  const harness = makeManualInternals({ mediaDevices: deferred.mediaDevices });
  const createFrameSource = vi.fn(harness.internals.createFrameSource!);
  const createRunner = vi.fn(harness.internals.createRunner!);
  const scanner = new QrScanner(
    video,
    {},
    { ...harness.internals, createFrameSource, createRunner },
  );
  return { scanner, video, deferred, createFrameSource, createRunner, loop: harness.loop };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('QrScanner teardown races', () => {
  it('destroy() during start()’s getUserMedia stops the late stream and stays dead', async () => {
    const { scanner, video, deferred, createFrameSource, createRunner, loop } = makeRacyScanner();
    const addListener = vi.spyOn(document, 'addEventListener');

    const starting = scanner.start();
    scanner.destroy();

    const track = makeFakeTrack();
    await deferred.resolveNext(makeFakeStream(track));
    await starting; // the abandoned acquisition resolves silently, not with an error

    // The freshly acquired stream is released — the camera LED goes off.
    expect(track.stop).toHaveBeenCalled();
    // Nothing was resurrected: no video attach, no pipeline, no listener, no loop.
    expect(video.play).not.toHaveBeenCalled();
    expect(video.srcObject).toBeNull();
    expect(createFrameSource).not.toHaveBeenCalled();
    expect(createRunner).not.toHaveBeenCalled();
    expect(addListener).not.toHaveBeenCalledWith('visibilitychange', expect.any(Function));
    expect(loop.pendingTicks()).toBe(0);
    await expect(scanner.start()).rejects.toThrow('destroyed');
  });

  it('stop() during start()’s getUserMedia releases the late stream', async () => {
    const { scanner, deferred, loop } = makeRacyScanner();
    const starting = scanner.start();
    scanner.stop();

    const track = makeFakeTrack();
    await deferred.resolveNext(makeFakeStream(track));
    await starting;

    expect(track.stop).toHaveBeenCalled();
    expect(loop.pendingTicks()).toBe(0);
    scanner.destroy();
  });

  it('overlapping acquisitions (restart mid-flight) leave exactly one live stream', async () => {
    const { scanner, deferred, loop } = makeRacyScanner();
    const started = vi.fn();
    scanner.on('start', started);

    const first = scanner.start();
    scanner.stop();
    const second = scanner.start();
    expect(deferred.pendingCount()).toBe(2);

    const trackA = makeFakeTrack();
    const trackB = makeFakeTrack();
    await deferred.resolveNext(makeFakeStream(trackA)); // first acquisition — superseded
    await deferred.resolveNext(makeFakeStream(trackB)); // second — the live one
    await first;
    await second;

    expect(trackA.stop).toHaveBeenCalled();
    expect(trackB.stop).not.toHaveBeenCalled();
    expect(started).toHaveBeenCalledTimes(1); // only the second start went live
    expect(loop.pendingTicks()).toBe(1); // exactly one scan loop
    scanner.destroy();
    expect(trackB.stop).toHaveBeenCalled();
  });

  it('destroy() during setCamera() stops the newly acquired stream', async () => {
    const { scanner, video, deferred, loop } = makeRacyScanner();
    const starting = scanner.start();
    const trackA = makeFakeTrack();
    await deferred.resolveNext(makeFakeStream(trackA));
    await starting;

    const switching = scanner.setCamera({ facing: 'user' });
    expect(trackA.stop).toHaveBeenCalled(); // old stream released before reacquiring
    scanner.destroy();

    const trackB = makeFakeTrack();
    await deferred.resolveNext(makeFakeStream(trackB));
    await switching;

    expect(trackB.stop).toHaveBeenCalled();
    expect(video.srcObject).toBeNull();
    expect(video.play).toHaveBeenCalledTimes(1); // only the original start attached
    expect(loop.pendingTicks()).toBe(0);
  });

  it('a failed camera switch stops cleanly instead of reporting scanning with no camera', async () => {
    const { scanner, deferred, loop } = makeRacyScanner();
    const starting = scanner.start();
    await deferred.resolveNext(makeFakeStream(makeFakeTrack()));
    await starting;

    const stopped = vi.fn();
    scanner.on('stop', stopped);
    const switching = scanner.setCamera({ facing: 'user' });
    // Attach the handler before the rejection lands to keep it handled.
    const rejection = expect(switching).rejects.toMatchObject({
      name: 'CameraError',
      code: 'camera-in-use',
    });
    await deferred.rejectNext({ name: 'NotReadableError', message: 'busy' });
    await rejection;
    expect(stopped).toHaveBeenCalledOnce();
    expect(loop.pendingTicks()).toBe(0);

    // The scanner is recoverable: a fresh start() reacquires and scans.
    const trackB = makeFakeTrack();
    const restarting = scanner.start();
    await deferred.resolveNext(makeFakeStream(trackB));
    await restarting;
    expect(trackB.stop).not.toHaveBeenCalled();
    expect(loop.pendingTicks()).toBe(1);
    scanner.destroy();
  });
});
