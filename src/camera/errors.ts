export type CameraErrorCode =
  | 'insecure-context'
  | 'unsupported'
  | 'permission-denied'
  | 'camera-not-found'
  | 'camera-in-use'
  | 'stream-failed';

/** Typed camera/stream failure — match on `code`, not message strings. */
export class CameraError extends Error {
  override readonly name = 'CameraError';

  constructor(
    readonly code: CameraErrorCode,
    message: string,
    readonly cause?: unknown,
  ) {
    super(message);
  }

  /** Maps a getUserMedia rejection to a typed CameraError. */
  static from(error: unknown): CameraError {
    if (error instanceof CameraError) return error;
    const name = (error as { name?: string })?.name ?? '';
    switch (name) {
      case 'NotAllowedError':
      case 'PermissionDeniedError':
      case 'SecurityError':
        return new CameraError('permission-denied', 'camera permission was denied', error);
      case 'NotFoundError':
      case 'DevicesNotFoundError':
      case 'OverconstrainedError':
        return new CameraError('camera-not-found', 'no camera matches the constraints', error);
      case 'NotReadableError':
      case 'TrackStartError':
        return new CameraError('camera-in-use', 'camera is already in use or unreadable', error);
      default:
        return new CameraError('stream-failed', 'could not start the camera stream', error);
    }
  }
}
