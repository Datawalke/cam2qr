import { DecodeError } from '../errors.js';

/** MSB-first bit reader over a byte array. */
export class BitReader {
  private byteOffset = 0;
  private bitOffset = 0;

  constructor(private readonly bytes: Uint8Array) {}

  available(): number {
    return 8 * (this.bytes.length - this.byteOffset) - this.bitOffset;
  }

  read(numBits: number): number {
    if (numBits < 1 || numBits > 32) {
      throw new RangeError(`cannot read ${numBits} bits at once`);
    }
    // Exhaustion is a data error, not a caller bug: a miscorrected block can
    // put arbitrary counts in front of too few payload bits, and that must
    // surface as an undecodable symbol rather than escape decode().
    if (numBits > this.available()) {
      throw new DecodeError(
        'bitstream',
        `bitstream exhausted: needed ${numBits} bits, ${this.available()} available`,
      );
    }
    let result = 0;
    let remaining = numBits;
    while (remaining > 0) {
      const bitsLeftInByte = 8 - this.bitOffset;
      const toRead = Math.min(remaining, bitsLeftInByte);
      const shift = bitsLeftInByte - toRead;
      const mask = ((1 << toRead) - 1) << shift;
      result = (result << toRead) | ((this.bytes[this.byteOffset]! & mask) >> shift);
      remaining -= toRead;
      this.bitOffset += toRead;
      if (this.bitOffset === 8) {
        this.bitOffset = 0;
        this.byteOffset++;
      }
    }
    return result;
  }
}
