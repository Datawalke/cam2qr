import { describe, expect, it } from 'vitest';
import { applyTorch, applyZoom, getTrackCapabilities } from '../../src/camera/capabilities.js';
import { CameraError } from '../../src/camera/errors.js';
import { clampRegion } from '../../src/camera/frame-grabber.js';
import { buildConstraints, listCameras, startStream } from '../../src/camera/stream.js';
import { makeFakeTrack } from '../helpers/camera-fakes.js';

describe('buildConstraints', () => {
  it('defaults to the rear camera at 720p', () => {
    const constraints = buildConstraints();
    expect(constraints.audio).toBe(false);
    const video = constraints.video as MediaTrackConstraints;
    expect(video.facingMode).toEqual({ ideal: 'environment' });
    expect(video.width).toEqual({ ideal: 1280 });
    expect(video.height).toEqual({ ideal: 720 });
  });

  it('prefers an explicit device over facing mode', () => {
    const video = buildConstraints({ deviceId: 'abc', facing: 'user' })
      .video as MediaTrackConstraints;
    expect(video.deviceId).toEqual({ exact: 'abc' });
    expect(video.facingMode).toBeUndefined();
  });

  it('honors a resolution preference', () => {
    const video = buildConstraints({ resolution: { width: 1920, height: 1080 } })
      .video as MediaTrackConstraints;
    expect(video.width).toEqual({ ideal: 1920 });
    expect(video.height).toEqual({ ideal: 1080 });
  });
});

describe('CameraError.from', () => {
  const cases: Array<[string, string]> = [
    ['NotAllowedError', 'permission-denied'],
    ['NotFoundError', 'camera-not-found'],
    ['OverconstrainedError', 'camera-not-found'],
    ['NotReadableError', 'camera-in-use'],
    ['SomethingElseError', 'stream-failed'],
  ];
  for (const [domName, code] of cases) {
    it(`maps ${domName} to ${code}`, () => {
      const error = CameraError.from({ name: domName, message: 'x' });
      expect(error).toBeInstanceOf(CameraError);
      expect(error.code).toBe(code);
    });
  }

  it('passes through existing CameraErrors', () => {
    const original = new CameraError('unsupported', 'nope');
    expect(CameraError.from(original)).toBe(original);
  });
});

describe('startStream', () => {
  it('rejects with a typed error when getUserMedia fails', async () => {
    const mediaDevices = {
      getUserMedia: async () => {
        throw { name: 'NotAllowedError', message: 'denied' };
      },
    } as unknown as MediaDevices;
    await expect(startStream({}, mediaDevices)).rejects.toMatchObject({
      name: 'CameraError',
      code: 'permission-denied',
    });
  });

  it('reports unsupported environments (like this Node process)', async () => {
    await expect(startStream({})).rejects.toMatchObject({ code: 'unsupported' });
  });
});

describe('listCameras', () => {
  it('filters to video inputs and fills in blank labels', async () => {
    const mediaDevices = {
      enumerateDevices: async () => [
        { kind: 'videoinput', deviceId: 'v1', label: 'Back Camera' },
        { kind: 'audioinput', deviceId: 'a1', label: 'Mic' },
        { kind: 'videoinput', deviceId: 'v2', label: '' },
      ],
    } as unknown as MediaDevices;
    expect(await listCameras(mediaDevices)).toEqual([
      { id: 'v1', label: 'Back Camera' },
      { id: 'v2', label: 'Camera 2' },
    ]);
  });

  it('returns an empty list without media devices', async () => {
    expect(await listCameras()).toEqual([]);
  });
});

describe('track capabilities', () => {
  it('detects torch and zoom ranges', () => {
    const track = makeFakeTrack({ torch: true, zoom: { min: 1, max: 5, step: 0.5 } });
    expect(getTrackCapabilities(track as unknown as MediaStreamTrack)).toEqual({
      torch: true,
      zoom: { min: 1, max: 5, step: 0.5 },
    });
  });

  it('reports absent capabilities as unsupported', () => {
    const track = makeFakeTrack({});
    expect(getTrackCapabilities(track as unknown as MediaStreamTrack)).toEqual({
      torch: false,
      zoom: null,
    });
  });

  it('applies torch only when supported', async () => {
    const supported = makeFakeTrack({ torch: true });
    expect(await applyTorch(supported as unknown as MediaStreamTrack, true)).toBe(true);
    expect(supported.applyConstraints).toHaveBeenCalledWith({ advanced: [{ torch: true }] });

    const unsupported = makeFakeTrack({});
    expect(await applyTorch(unsupported as unknown as MediaStreamTrack, true)).toBe(false);
    expect(unsupported.applyConstraints).not.toHaveBeenCalled();
  });

  it('clamps zoom to the supported range', async () => {
    const track = makeFakeTrack({ zoom: { min: 1, max: 4, step: 0.1 } });
    expect(await applyZoom(track as unknown as MediaStreamTrack, 10)).toBe(true);
    expect(track.applyConstraints).toHaveBeenCalledWith({ advanced: [{ zoom: 4 }] });
  });
});

describe('clampRegion', () => {
  it('passes through undefined as the full frame', () => {
    expect(clampRegion(undefined, 640, 480)).toEqual({ x: 0, y: 0, width: 640, height: 480 });
  });

  it('clamps out-of-bounds regions into the frame', () => {
    expect(clampRegion({ x: -10, y: 400, width: 1000, height: 1000 }, 640, 480)).toEqual({
      x: 0,
      y: 400,
      width: 640,
      height: 80,
    });
  });
});
