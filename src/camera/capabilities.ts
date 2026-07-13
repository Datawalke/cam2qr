export interface CameraCapabilities {
  torch: boolean;
  zoom: { min: number; max: number; step: number } | null;
}

/** Torch/zoom live in vendor extensions the DOM types don't know about. */
type ExtendedCapabilities = {
  torch?: boolean;
  zoom?: { min?: number; max?: number; step?: number };
};

export function getTrackCapabilities(track: MediaStreamTrack): CameraCapabilities {
  const raw: ExtendedCapabilities =
    typeof track.getCapabilities === 'function'
      ? (track.getCapabilities() as ExtendedCapabilities)
      : {};
  const zoom = raw.zoom;
  return {
    torch: raw.torch === true,
    zoom:
      zoom && typeof zoom.min === 'number' && typeof zoom.max === 'number'
        ? { min: zoom.min, max: zoom.max, step: zoom.step ?? 0.1 }
        : null,
  };
}

/**
 * Turns the torch on/off. Resolves to false (without throwing) when the
 * device has no controllable torch, so callers can no-op gracefully.
 */
export async function applyTorch(track: MediaStreamTrack, on: boolean): Promise<boolean> {
  if (!getTrackCapabilities(track).torch) return false;
  await track.applyConstraints({ advanced: [{ torch: on } as MediaTrackConstraintSet] });
  return true;
}

/** Sets zoom, clamped to the supported range. False when unsupported. */
export async function applyZoom(track: MediaStreamTrack, zoom: number): Promise<boolean> {
  const range = getTrackCapabilities(track).zoom;
  if (range === null) return false;
  const clamped = Math.min(range.max, Math.max(range.min, zoom));
  await track.applyConstraints({ advanced: [{ zoom: clamped } as MediaTrackConstraintSet] });
  return true;
}
