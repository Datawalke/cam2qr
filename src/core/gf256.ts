/**
 * Arithmetic in GF(2^8) as used by QR error correction: the field is built
 * from the primitive polynomial x^8 + x^4 + x^3 + x^2 + 1 (0x11d) with
 * generator α = 2 (ISO/IEC 18004 §8.5.2). Log/antilog lookup tables are the
 * standard implementation technique for the field operations.
 *
 * Polynomials over the field are plain Uint8Arrays in ascending-degree order:
 * p[i] is the coefficient of x^i.
 */

const PRIMITIVE = 0x11d;
/** Multiplicative order of the field: α^255 = 1. */
const ORDER = 255;

/** antilog[e] = α^e; doubled in length so summed logs index without a mod. */
const antilog = new Uint8Array(ORDER * 2);
/** logOf[v] = e with α^e = v, for v ≥ 1 (index 0 is unused). */
const logOf = new Uint8Array(256);

{
  let value = 1;
  for (let e = 0; e < ORDER; e++) {
    antilog[e] = value;
    antilog[e + ORDER] = value;
    logOf[value] = e;
    value <<= 1;
    if (value & 0x100) value ^= PRIMITIVE;
  }
}

/** α^e for any integer exponent, including negative ones. */
export function alphaPow(e: number): number {
  return antilog[((e % ORDER) + ORDER) % ORDER]!;
}

/** Discrete log base α of a non-zero field element. */
export function gfLog(a: number): number {
  if (a === 0) throw new RangeError('zero has no discrete log in GF(256)');
  return logOf[a]!;
}

export function gfMul(a: number, b: number): number {
  if (a === 0 || b === 0) return 0;
  return antilog[logOf[a]! + logOf[b]!]!;
}

export function gfDiv(a: number, b: number): number {
  if (b === 0) throw new RangeError('division by zero in GF(256)');
  if (a === 0) return 0;
  return antilog[logOf[a]! + ORDER - logOf[b]!]!;
}

/** Multiplicative inverse of a non-zero field element. */
export function gfInv(a: number): number {
  if (a === 0) throw new RangeError('zero is not invertible in GF(256)');
  return antilog[ORDER - logOf[a]!]!;
}

/** Evaluates the ascending-degree polynomial p at x by Horner's rule. */
export function polyEval(p: Uint8Array, x: number): number {
  let acc = 0;
  for (let i = p.length - 1; i >= 0; i--) {
    acc = gfMul(acc, x) ^ p[i]!;
  }
  return acc;
}

/** Product of two ascending-degree polynomials (fresh buffer). */
export function polyMul(a: Uint8Array, b: Uint8Array): Uint8Array {
  const out = new Uint8Array(a.length + b.length - 1);
  for (let i = 0; i < a.length; i++) {
    const coeff = a[i]!;
    if (coeff === 0) continue;
    for (let j = 0; j < b.length; j++) {
      out[i + j]! ^= gfMul(coeff, b[j]!);
    }
  }
  return out;
}

/**
 * XORs `scale · x^shift · addend` into `target`, in place. Terms that would
 * land beyond the end of `target` are dropped.
 */
export function polyMulAddInto(
  target: Uint8Array,
  addend: Uint8Array,
  scale: number,
  shift: number,
): void {
  const limit = Math.min(addend.length, target.length - shift);
  for (let i = 0; i < limit; i++) {
    target[i + shift]! ^= gfMul(scale, addend[i]!);
  }
}
