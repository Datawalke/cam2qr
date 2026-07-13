import { parseContent } from '../content/parse.js';
import type { QrResult, StructuredAppend } from '../types.js';

/** How long a partial sequence waits for its remaining symbols. */
const DEFAULT_PART_TTL_MS = 30_000;

/**
 * Collects structured-append symbols across scan ticks and joins a sequence
 * once every part has been seen and the parity byte (XOR of all payload
 * bytes) checks out. Parts re-seen while in view refresh their sequence and
 * replace earlier sightings, so a transiently misdecoded part heals itself.
 * A completed sequence keeps returning its joined result on later sightings;
 * the scanner's deduper decides when that re-fires.
 */
export class StructuredAppendAssembler {
  private readonly sequences = new Map<
    string,
    { parts: Map<number, QrResult>; lastSeenAt: number }
  >();

  constructor(private readonly ttlMs = DEFAULT_PART_TTL_MS) {}

  /**
   * Records one symbol carrying a structured-append header. Returns the
   * joined result when its sequence is complete and parity-valid, else null.
   */
  add(result: QrResult, now: number): QrResult | null {
    const header = result.structuredAppend;
    if (!header || header.total < 2 || header.index >= header.total) return null;
    this.expire(now);

    const key = `${header.total}:${header.parity}`;
    let sequence = this.sequences.get(key);
    if (!sequence) {
      sequence = { parts: new Map(), lastSeenAt: now };
      this.sequences.set(key, sequence);
    }
    sequence.parts.set(header.index, result);
    sequence.lastSeenAt = now;
    return joinParts(sequence.parts, header);
  }

  reset(): void {
    this.sequences.clear();
  }

  private expire(now: number): void {
    for (const [key, sequence] of this.sequences) {
      if (now - sequence.lastSeenAt > this.ttlMs) this.sequences.delete(key);
    }
  }
}

function joinParts(parts: Map<number, QrResult>, header: StructuredAppend): QrResult | null {
  const ordered: QrResult[] = [];
  for (let i = 0; i < header.total; i++) {
    const part = parts.get(i);
    if (!part) return null;
    ordered.push(part);
  }

  let totalBytes = 0;
  for (const part of ordered) totalBytes += part.bytes.length;
  const bytes = new Uint8Array(totalBytes);
  let offset = 0;
  let parity = 0;
  for (const part of ordered) {
    bytes.set(part.bytes, offset);
    offset += part.bytes.length;
    for (const byte of part.bytes) parity ^= byte;
  }
  // A parity mismatch means a misdecoded part or two interleaved sequences
  // sharing a bucket — withhold and let re-sightings replace the bad part.
  if (parity !== header.parity) return null;

  const text = ordered.map((part) => part.text).join('');
  // Geometry and symbol metadata come from the sequence's final symbol.
  const last = ordered[ordered.length - 1]!;
  return {
    ...last,
    text,
    bytes,
    segments: ordered.flatMap((part) => part.segments),
    ecc: {
      blocks: ordered.reduce((sum, part) => sum + part.ecc.blocks, 0),
      codewordsCorrected: ordered.reduce((sum, part) => sum + part.ecc.codewordsCorrected, 0),
    },
    content: parseContent(text, { gs1: last.fnc1?.position === 'first' }),
  };
}
