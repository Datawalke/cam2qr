import { DecodeError } from '../errors.js';
import { alphaPow, gfDiv, gfMul, polyEval, polyMulAddInto } from './gf256.js';

/**
 * Reed–Solomon error correction for QR blocks over GF(256). QR codewords are
 * encoded with generator roots α^0 … α^(ecCount−1) (ISO/IEC 18004 §8.5.2);
 * decoding here follows the classic textbook pipeline — Berlekamp–Massey for
 * the error-locator polynomial, a Chien search for its roots, and Forney's
 * formula for the error magnitudes (see Lin & Costello, "Error Control
 * Coding", ch. 7, or Blahut, "Algebraic Codes for Data Transmission").
 *
 * All polynomials are ascending-degree Uint8Arrays (see gf256.ts). The
 * received block itself is the usual wire order: codewords[0] carries the
 * highest power of x.
 */

/**
 * Corrects up to ⌊ecCount/2⌋ codeword errors in place and returns how many
 * were corrected. Throws DecodeError('reed-solomon') when the block is
 * uncorrectable.
 */
export function rsCorrect(codewords: Uint8Array, ecCount: number): number {
  const length = codewords.length;

  // Syndromes S_j = R(α^j) for j = 0 … ecCount−1, stored ascending in j.
  const syndromes = new Uint8Array(ecCount);
  let damaged = false;
  for (let j = 0; j < ecCount; j++) {
    const point = alphaPow(j);
    let acc = 0;
    for (let i = 0; i < length; i++) {
      acc = gfMul(acc, point) ^ codewords[i]!;
    }
    syndromes[j] = acc;
    if (acc !== 0) damaged = true;
  }
  if (!damaged) return 0;

  const locator = berlekampMassey(syndromes);
  const errorCount = locatorDegree(locator);
  if (2 * errorCount > ecCount) {
    throw new DecodeError('reed-solomon', 'block damage exceeds correction capacity');
  }

  // Chien search: an error at degree k of R(x) makes α^−k a root of Λ.
  const errorDegrees: number[] = [];
  for (let k = 0; k < length; k++) {
    if (polyEval(locator, alphaPow(-k)) === 0) errorDegrees.push(k);
  }
  if (errorDegrees.length !== errorCount) {
    throw new DecodeError('reed-solomon', 'could not locate all codeword errors');
  }

  // Forney: Ω(x) = S(x)·Λ(x) mod x^ecCount, then the magnitude of the error
  // with locator X = α^k is X · Ω(X⁻¹) / Λ′(X⁻¹) (first generator root is
  // α^0, so the X^(1−b) factor reduces to X).
  const evaluator = new Uint8Array(ecCount);
  for (let i = 0; i < locator.length; i++) {
    if (locator[i] !== 0) polyMulAddInto(evaluator, syndromes, locator[i]!, i);
  }

  for (const k of errorDegrees) {
    const inverse = alphaPow(-k);
    // Λ′ keeps only Λ's odd-degree terms (formal derivative in char 2).
    let slope = 0;
    for (let i = 1; i < locator.length; i += 2) {
      if (locator[i] !== 0) slope ^= gfMul(locator[i]!, alphaPow(-k * (i - 1)));
    }
    if (slope === 0) {
      throw new DecodeError('reed-solomon', 'inconsistent error location in block');
    }
    const magnitude = gfMul(alphaPow(k), gfDiv(polyEval(evaluator, inverse), slope));
    codewords[length - 1 - k]! ^= magnitude;
  }
  return errorCount;
}

// #region snippet: reed-solomon
/**
 * Berlekamp–Massey: returns the shortest LFSR (as the connection polynomial
 * Λ, ascending degree, Λ(0) = 1) that generates the syndrome sequence.
 */
function berlekampMassey(syndromes: Uint8Array): Uint8Array {
  const rounds = syndromes.length;
  const current = new Uint8Array(rounds + 1); // Λ under construction
  let fallback = new Uint8Array(rounds + 1); // copy of Λ from the last length change
  current[0] = 1;
  fallback[0] = 1;
  let lfsrLength = 0;
  let sinceChange = 1; // rounds elapsed since `fallback` was taken
  let changeDelta = 1; // discrepancy observed at that change

  for (let round = 0; round < rounds; round++) {
    let delta = syndromes[round]!;
    for (let i = 1; i <= lfsrLength; i++) {
      delta ^= gfMul(current[i]!, syndromes[round - i]!);
    }
    if (delta === 0) {
      sinceChange++;
      continue;
    }
    const grows = 2 * lfsrLength <= round;
    const snapshot = grows ? current.slice() : undefined;
    polyMulAddInto(current, fallback, gfDiv(delta, changeDelta), sinceChange);
    if (grows) {
      lfsrLength = round + 1 - lfsrLength;
      fallback = snapshot!;
      changeDelta = delta;
      sinceChange = 1;
    } else {
      sinceChange++;
    }
  }
  return current.subarray(0, lfsrLength + 1);
}
// #endregion snippet

/** Actual degree of Λ (highest non-zero coefficient). */
function locatorDegree(locator: Uint8Array): number {
  for (let i = locator.length - 1; i > 0; i--) {
    if (locator[i] !== 0) return i;
  }
  return 0;
}
