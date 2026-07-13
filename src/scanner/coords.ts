import type { Point } from '../types.js';

/**
 * Maps points from video pixel coordinates (as reported in QrResult and
 * Detection corner points) to CSS pixel coordinates relative to the video
 * element's top-left corner, accounting for object-fit scaling, letterboxing,
 * and cropping. Assumes the default centered object-position. Use this to
 * place an overlay element laid out on top of the video; a canvas sized to
 * videoWidth×videoHeight and CSS-stretched with the same object-fit does not
 * need it.
 */
export function videoToElementCoordinates(
  points: readonly Point[],
  video: HTMLVideoElement,
): Point[] {
  const { videoWidth, videoHeight, clientWidth, clientHeight } = video;
  if (videoWidth === 0 || videoHeight === 0) {
    return points.map((point) => ({ x: point.x, y: point.y }));
  }
  const fitX = clientWidth / videoWidth;
  const fitY = clientHeight / videoHeight;
  let scaleX = fitX;
  let scaleY = fitY;
  const objectFit =
    typeof getComputedStyle === 'function' ? getComputedStyle(video).objectFit || 'fill' : 'fill';
  switch (objectFit) {
    case 'contain':
      scaleX = scaleY = Math.min(fitX, fitY);
      break;
    case 'cover':
      scaleX = scaleY = Math.max(fitX, fitY);
      break;
    case 'none':
      scaleX = scaleY = 1;
      break;
    case 'scale-down':
      scaleX = scaleY = Math.min(1, fitX, fitY);
      break;
    default:
      break; // 'fill' stretches both axes independently
  }
  const offsetX = (clientWidth - videoWidth * scaleX) / 2;
  const offsetY = (clientHeight - videoHeight * scaleY) / 2;
  return points.map((point) => ({
    x: point.x * scaleX + offsetX,
    y: point.y * scaleY + offsetY,
  }));
}
