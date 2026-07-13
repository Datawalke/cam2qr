export type DecodeErrorCode =
  | 'detect'
  | 'invalid-dimension'
  | 'format-info'
  | 'version-info'
  | 'codewords'
  | 'reed-solomon'
  | 'bitstream'
  | 'unsupported-mode';

/** Thrown when a bit matrix cannot be decoded as a valid QR symbol. */
export class DecodeError extends Error {
  override readonly name = 'DecodeError';

  constructor(
    readonly code: DecodeErrorCode,
    message: string,
  ) {
    super(message);
  }
}
