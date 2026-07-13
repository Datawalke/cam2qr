export type { CameraCapabilities } from './camera/capabilities.js';
export { CameraError, type CameraErrorCode } from './camera/errors.js';
export type { FrameSource, Region } from './camera/frame-grabber.js';
export { type CameraDevice, type CameraOptions, listCameras } from './camera/stream.js';
export { type ParseContentHints, type ParsedContent, parseContent } from './content/parse.js';
export { BitMatrix } from './core/bit-matrix.js';
export { decodeMatrix } from './core/decode-matrix.js';
export { decode, decodeAll, detect } from './decode.js';
export { DecodeError, type DecodeErrorCode } from './errors.js';
export { videoToElementCoordinates } from './scanner/coords.js';
export {
  QrScanner,
  type QrScannerOptions,
  type QrScannerUpdate,
  type ScannerEventMap,
} from './scanner/scanner.js';
export type {
  DecodedMatrix,
  DecodeImageOptions,
  DetectImageOptions,
  Detection,
  ErrorCorrectionLevel,
  Fnc1,
  ImageDataLike,
  Point,
  QrResult,
  Segment,
  StructuredAppend,
} from './types.js';
