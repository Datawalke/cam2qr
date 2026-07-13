/**
 * BCH encoding/decoding for the QR format and version information fields.
 * Both fields are short enough that decoding is a minimum-Hamming-distance
 * search over the full table of valid codewords.
 */

/** Remainder of value·x^degree(poly−1) divided by the generator polynomial. */
export function bchRemainder(value: number, generator: number): number {
  const generatorDegree = 31 - Math.clz32(generator);
  let remainder = value << generatorDegree;
  while (31 - Math.clz32(remainder) >= generatorDegree && remainder !== 0) {
    remainder ^= generator << (31 - Math.clz32(remainder) - generatorDegree);
  }
  return remainder;
}

const FORMAT_GENERATOR = 0x537; // x^10 + x^8 + x^5 + x^4 + x^2 + x + 1
const FORMAT_MASK = 0x5412;
const VERSION_GENERATOR = 0x1f25; // x^12 + x^11 + x^10 + x^9 + x^8 + x^5 + x^2 + 1

/** 15-bit masked format codeword for a 5-bit (ecBits<<3 | mask) value. */
export function encodeFormatInfo(data: number): number {
  return ((data << 10) | bchRemainder(data, FORMAT_GENERATOR)) ^ FORMAT_MASK;
}

/** 18-bit version codeword for a 6-bit version number (7..40). */
export function encodeVersionInfo(version: number): number {
  return (version << 12) | bchRemainder(version, VERSION_GENERATOR);
}

function hammingDistance(a: number, b: number): number {
  let x = a ^ b;
  let count = 0;
  while (x !== 0) {
    x &= x - 1;
    count++;
  }
  return count;
}

/**
 * Nearest-codeword decode over one or two independent readings of the same
 * field. A candidate's distance is its distance to the *better-preserved*
 * reading, so a clean copy can never be shadowed by a copy damaged into the
 * neighborhood of a different codeword; ties fall to the summed distance.
 * Returns the data value within maxDistance bits, or null when nothing is
 * close enough.
 */
function decodeNearest(
  bits: number,
  secondBits: number | null,
  candidates: ReadonlyArray<readonly [data: number, codeword: number]>,
  maxDistance: number,
): number | null {
  let bestData: number | null = null;
  let bestNearest = maxDistance + 1;
  let bestTotal = Number.POSITIVE_INFINITY;
  for (const [data, codeword] of candidates) {
    const first = hammingDistance(bits, codeword);
    const second = secondBits === null ? first : hammingDistance(secondBits, codeword);
    const nearest = Math.min(first, second);
    const total = first + second;
    if (nearest < bestNearest || (nearest === bestNearest && total < bestTotal)) {
      bestNearest = nearest;
      bestTotal = total;
      bestData = data;
    }
  }
  return bestNearest <= maxDistance ? bestData : null;
}

const FORMAT_TABLE: ReadonlyArray<readonly [number, number]> = Array.from(
  { length: 32 },
  (_, data) => [data, encodeFormatInfo(data)] as const,
);

const VERSION_TABLE: ReadonlyArray<readonly [number, number]> = Array.from(
  { length: 34 },
  (_, i) => [i + 7, encodeVersionInfo(i + 7)] as const,
);

/**
 * Decodes 15 read format bits to (ecBits<<3 | mask), correcting up to 3 bit
 * errors in the better-preserved of the given copies. Returns null when
 * uncorrectable.
 */
export function decodeFormatBits(bits: number, secondBits?: number): number | null {
  return decodeNearest(bits, secondBits ?? null, FORMAT_TABLE, 3);
}

/**
 * Decodes 18 read version bits to a version number 7..40, correcting up to
 * 3 bit errors in the better-preserved of the given copies. Returns null
 * when uncorrectable.
 */
export function decodeVersionBits(bits: number, secondBits?: number): number | null {
  return decodeNearest(bits, secondBits ?? null, VERSION_TABLE, 3);
}
