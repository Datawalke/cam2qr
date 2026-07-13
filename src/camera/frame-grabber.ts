import type { ImageDataLike } from '../types.js';

export interface Region {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Produces RGBA frames from a live source; a scanner-internal seam. */
export interface FrameSource {
  /** Returns the current frame (cropped to region), or null if not ready. */
  grab(region?: Region): ImageDataLike | null;
  destroy(): void;
}

/**
 * Default frame source: draws the video onto a reused canvas and reads the
 * pixels back. Uses OffscreenCanvas when available (no DOM node churn).
 */
export function createCanvasFrameSource(video: HTMLVideoElement): FrameSource {
  let canvas: OffscreenCanvas | HTMLCanvasElement | null = null;
  let context: OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D | null = null;

  function ensureContext(width: number, height: number): typeof context {
    if (!canvas) {
      canvas =
        typeof OffscreenCanvas !== 'undefined'
          ? new OffscreenCanvas(width, height)
          : document.createElement('canvas');
    }
    if (canvas.width !== width) canvas.width = width;
    if (canvas.height !== height) canvas.height = height;
    if (!context) {
      context = (canvas as HTMLCanvasElement).getContext('2d', {
        willReadFrequently: true,
      }) as CanvasRenderingContext2D | null;
    }
    return context;
  }

  return {
    grab(region?: Region): ImageDataLike | null {
      const videoWidth = video.videoWidth;
      const videoHeight = video.videoHeight;
      if (!videoWidth || !videoHeight) return null;

      const crop = clampRegion(region, videoWidth, videoHeight);
      const ctx = ensureContext(crop.width, crop.height);
      if (!ctx) return null;
      ctx.drawImage(video, crop.x, crop.y, crop.width, crop.height, 0, 0, crop.width, crop.height);
      return ctx.getImageData(0, 0, crop.width, crop.height);
    },
    destroy(): void {
      canvas = null;
      context = null;
    },
  };
}

export function clampRegion(region: Region | undefined, width: number, height: number): Region {
  if (!region) return { x: 0, y: 0, width, height };
  const x = Math.max(0, Math.min(Math.floor(region.x), width - 1));
  const y = Math.max(0, Math.min(Math.floor(region.y), height - 1));
  return {
    x,
    y,
    width: Math.max(1, Math.min(Math.floor(region.width), width - x)),
    height: Math.max(1, Math.min(Math.floor(region.height), height - y)),
  };
}
