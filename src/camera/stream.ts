import { CameraError } from './errors.js';

export interface CameraOptions {
  /** Which way the camera faces; ignored when deviceId is set. */
  facing?: 'environment' | 'user';
  /** Exact camera device (from listCameras()). */
  deviceId?: string;
  /** Ideal capture resolution; the browser picks the closest mode. */
  resolution?: { width?: number; height?: number };
}

export function buildConstraints(camera: CameraOptions = {}): MediaStreamConstraints {
  const video: MediaTrackConstraints = {
    width: { ideal: camera.resolution?.width ?? 1280 },
    height: { ideal: camera.resolution?.height ?? 720 },
  };
  if (camera.deviceId !== undefined) {
    video.deviceId = { exact: camera.deviceId };
  } else {
    video.facingMode = { ideal: camera.facing ?? 'environment' };
  }
  return { video, audio: false };
}

function resolveMediaDevices(override?: MediaDevices): MediaDevices | null {
  if (override) return override;
  if (typeof navigator !== 'undefined' && navigator.mediaDevices) return navigator.mediaDevices;
  return null;
}

/** Requests a camera stream, translating failures to typed CameraErrors. */
export async function startStream(
  camera: CameraOptions = {},
  mediaDevicesOverride?: MediaDevices,
): Promise<MediaStream> {
  const mediaDevices = resolveMediaDevices(mediaDevicesOverride);
  if (!mediaDevices?.getUserMedia) {
    if (typeof window !== 'undefined' && window.isSecureContext === false) {
      throw new CameraError(
        'insecure-context',
        'camera access requires a secure context (HTTPS or localhost)',
      );
    }
    throw new CameraError('unsupported', 'getUserMedia is not available in this environment');
  }
  try {
    return await mediaDevices.getUserMedia(buildConstraints(camera));
  } catch (error) {
    throw CameraError.from(error);
  }
}

export function stopStream(stream: MediaStream): void {
  for (const track of stream.getTracks()) track.stop();
}

export interface CameraDevice {
  id: string;
  label: string;
}

/**
 * Lists available cameras. Labels are only populated once the user has
 * granted camera permission (a platform privacy rule, not ours).
 */
export async function listCameras(mediaDevicesOverride?: MediaDevices): Promise<CameraDevice[]> {
  const mediaDevices = resolveMediaDevices(mediaDevicesOverride);
  if (!mediaDevices?.enumerateDevices) return [];
  const devices = await mediaDevices.enumerateDevices();
  return devices
    .filter((device) => device.kind === 'videoinput')
    .map((device, index) => ({
      id: device.deviceId,
      label: device.label || `Camera ${index + 1}`,
    }));
}
