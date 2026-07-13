import { describe, expect, it } from 'vitest';
import { StructuredAppendAssembler } from '../../src/scanner/structured-append.js';
import type { QrResult } from '../../src/types.js';

function parityOf(texts: string[]): number {
  let parity = 0;
  for (const byte of new TextEncoder().encode(texts.join(''))) parity ^= byte;
  return parity;
}

function part(index: number, total: number, parity: number, text: string): QrResult {
  const bytes = new TextEncoder().encode(text);
  return {
    text,
    bytes,
    cornerPoints: [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
      { x: 0, y: 10 },
    ],
    moduleSize: 2,
    version: 1,
    errorCorrectionLevel: 'M',
    mask: 0,
    segments: [{ mode: 'byte', bytes, text }],
    ecc: { blocks: 1, codewordsCorrected: 0 },
    structuredAppend: { index, total, parity },
  };
}

describe('StructuredAppendAssembler', () => {
  it('joins a sequence once every part arrived, in index order', () => {
    const assembler = new StructuredAppendAssembler();
    const parity = parityOf(['hello ', 'wide ', 'world']);
    expect(assembler.add(part(2, 3, parity, 'world'), 0)).toBeNull();
    expect(assembler.add(part(0, 3, parity, 'hello '), 100)).toBeNull();
    const joined = assembler.add(part(1, 3, parity, 'wide '), 200);
    expect(joined).not.toBeNull();
    expect(joined!.text).toBe('hello wide world');
    expect(joined!.bytes).toEqual(new TextEncoder().encode('hello wide world'));
    expect(joined!.segments).toHaveLength(3);
    expect(joined!.ecc.blocks).toBe(3);
    expect(joined!.content).toEqual({ type: 'text', text: 'hello wide world' });
  });

  it('withholds the join while the parity byte mismatches, heals on re-sight', () => {
    const assembler = new StructuredAppendAssembler();
    const parity = parityOf(['good', 'data']);
    expect(assembler.add(part(0, 2, parity, 'good'), 0)).toBeNull();
    // A misdecoded second part: all symbols present but parity fails.
    expect(assembler.add(part(1, 2, parity, 'dbta'), 10)).toBeNull();
    // The camera re-sees the part correctly; the sequence completes.
    const joined = assembler.add(part(1, 2, parity, 'data'), 20);
    expect(joined!.text).toBe('gooddata');
  });

  it('keeps returning the joined result on later sightings', () => {
    const assembler = new StructuredAppendAssembler();
    const parity = parityOf(['a', 'b']);
    assembler.add(part(0, 2, parity, 'a'), 0);
    expect(assembler.add(part(1, 2, parity, 'b'), 10)!.text).toBe('ab');
    expect(assembler.add(part(0, 2, parity, 'a'), 20)!.text).toBe('ab');
  });

  it('expires stale partial sequences', () => {
    const assembler = new StructuredAppendAssembler(1000);
    const parity = parityOf(['a', 'b']);
    assembler.add(part(0, 2, parity, 'a'), 0);
    // Too late: the first part expired, so the sequence stays incomplete.
    expect(assembler.add(part(1, 2, parity, 'b'), 5000)).toBeNull();
    // Both seen within the window → joins.
    expect(assembler.add(part(0, 2, parity, 'a'), 5100)!.text).toBe('ab');
  });

  it('ignores malformed headers and single-symbol sequences', () => {
    const assembler = new StructuredAppendAssembler();
    expect(assembler.add(part(0, 1, 0, 'solo'), 0)).toBeNull();
    expect(assembler.add(part(5, 3, 0, 'oob'), 0)).toBeNull();
    const { structuredAppend: _header, ...plain } = part(0, 2, 0, 'x');
    expect(assembler.add(plain, 0)).toBeNull();
  });
});
