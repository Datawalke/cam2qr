import { alphaPow, gfMul, polyMul } from '../../src/core/gf256.js';

/** MSB-first bit writer for hand-crafting data bitstreams in tests. */
export class BitWriter {
  private readonly bits: number[] = [];

  write(value: number, numBits: number): this {
    for (let i = numBits - 1; i >= 0; i--) {
      this.bits.push((value >> i) & 1);
    }
    return this;
  }

  toBytes(): Uint8Array {
    const bytes = new Uint8Array(Math.ceil(this.bits.length / 8));
    for (let i = 0; i < this.bits.length; i++) {
      if (this.bits[i]) bytes[i >> 3]! |= 0x80 >> (i & 7);
    }
    return bytes;
  }
}

/**
 * Reference Reed–Solomon encoder (generator roots α^0..α^(ecCount-1)):
 * appends to `data` the remainder of data(x)·x^ecCount divided by the
 * generator polynomial.
 */
export function rsEncode(data: Uint8Array, ecCount: number): Uint8Array {
  // g(x) = Π (x + α^i), built ascending-degree; gDesc flips it so gDesc[0]
  // is the (monic) leading coefficient, matching the wire order below.
  let generator: Uint8Array = Uint8Array.of(1);
  for (let i = 0; i < ecCount; i++) {
    generator = polyMul(generator, Uint8Array.of(alphaPow(i), 1));
  }
  const gDesc = Uint8Array.from(generator).reverse();

  // Synthetic long division over the message followed by ecCount zeros.
  const work = new Uint8Array(data.length + ecCount);
  work.set(data);
  for (let i = 0; i < data.length; i++) {
    const factor = work[i]!;
    if (factor === 0) continue;
    for (let j = 0; j <= ecCount; j++) {
      work[i + j]! ^= gfMul(gDesc[j]!, factor);
    }
  }

  const out = new Uint8Array(data.length + ecCount);
  out.set(data);
  out.set(work.subarray(data.length), data.length);
  return out;
}
