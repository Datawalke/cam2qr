export { CameraError, QrScanner, listCameras } from './chunk-MYLBZOJV.js';
export { BitMatrix, DecodeError, decode, decodeAll, decodeMatrix, detect, parseContent } from './chunk-VQB7DEOH.js';

// src/scanner/coords.ts
function videoToElementCoordinates(points, video) {
  const { videoWidth, videoHeight, clientWidth, clientHeight } = video;
  if (videoWidth === 0 || videoHeight === 0) {
    return points.map((point) => ({ x: point.x, y: point.y }));
  }
  const fitX = clientWidth / videoWidth;
  const fitY = clientHeight / videoHeight;
  let scaleX = fitX;
  let scaleY = fitY;
  const objectFit = typeof getComputedStyle === "function" ? getComputedStyle(video).objectFit || "fill" : "fill";
  switch (objectFit) {
    case "contain":
      scaleX = scaleY = Math.min(fitX, fitY);
      break;
    case "cover":
      scaleX = scaleY = Math.max(fitX, fitY);
      break;
    case "none":
      scaleX = scaleY = 1;
      break;
    case "scale-down":
      scaleX = scaleY = Math.min(1, fitX, fitY);
      break;
  }
  const offsetX = (clientWidth - videoWidth * scaleX) / 2;
  const offsetY = (clientHeight - videoHeight * scaleY) / 2;
  return points.map((point) => ({
    x: point.x * scaleX + offsetX,
    y: point.y * scaleY + offsetY
  }));
}

export { videoToElementCoordinates };
//# sourceMappingURL=index.js.map
//# sourceMappingURL=index.js.map