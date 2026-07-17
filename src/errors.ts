export type DecodeErrorCode =
  | 'detect'
  | 'invalid-dimension'
  | 'format-info'
  | 'version-info'
  | 'codewords'
  | 'reed-solomon'
  | 'bitstream'
  | 'unsupported-mode'
  // The decode runner itself failed (e.g. the decode Web Worker crashed), as
  // opposed to a specific pipeline stage rejecting the symbol.
  | 'runner-failed';

/** Thrown when a bit matrix cannot be decoded as a valid QR symbol. */
export class DecodeError extends Error {
  override readonly name = 'DecodeError';

  constructor(
    readonly code: DecodeErrorCode,
    message: string,
    readonly cause?: unknown,
  ) {
    super(message);
  }

  /**
   * Wraps a decode/worker fault as a typed DecodeError, passing an existing
   * DecodeError through unchanged. Used to keep runner failures out of the
   * camera-stream error channel (see QrScanner's error event).
   */
  static from(error: unknown): DecodeError {
    if (error instanceof DecodeError) return error;
    const message = error instanceof Error ? error.message : String(error);
    return new DecodeError('runner-failed', message, error);
  }
}
