import { describe, expect, it } from 'vitest';
import { decodeSegments } from '../../src/core/segments.js';
import { DecodeError } from '../../src/errors.js';
import { BitWriter } from '../helpers/bits.js';

describe('decodeSegments', () => {
  it('decodes the spec numeric example "01234567"', () => {
    // ISO/IEC 18004 §8.4.2 example, version 1.
    const bits = new BitWriter()
      .write(0b0001, 4) // numeric mode
      .write(8, 10) // count
      .write(12, 10) // "012"
      .write(345, 10) // "345"
      .write(67, 7) // "67"
      .write(0, 4); // terminator
    const result = decodeSegments(bits.toBytes(), 1);
    expect(result.text).toBe('01234567');
    expect(result.segments).toEqual([{ mode: 'numeric', text: '01234567' }]);
  });

  it('decodes the spec alphanumeric example "AC-42"', () => {
    // A=10, C=12, -=41, 4=4, 2=2 → pairs (10·45+12), (41·45+4), single 2.
    const bits = new BitWriter()
      .write(0b0010, 4)
      .write(5, 9)
      .write(10 * 45 + 12, 11)
      .write(41 * 45 + 4, 11)
      .write(2, 6)
      .write(0, 4);
    const result = decodeSegments(bits.toBytes(), 1);
    expect(result.text).toBe('AC-42');
    expect(result.segments[0]).toEqual({ mode: 'alphanumeric', text: 'AC-42' });
  });

  it('decodes byte mode as UTF-8 when valid', () => {
    const payload = new TextEncoder().encode('héllo');
    const bits = new BitWriter().write(0b0100, 4).write(payload.length, 8);
    for (const byte of payload) bits.write(byte, 8);
    bits.write(0, 4);
    const result = decodeSegments(bits.toBytes(), 1);
    expect(result.text).toBe('héllo');
    expect(result.bytes).toEqual(payload);
  });

  it('falls back to ISO-8859-1 for invalid UTF-8', () => {
    const payload = Uint8Array.from([0xe9, 0x21]); // "é!" in latin-1, invalid UTF-8
    const bits = new BitWriter().write(0b0100, 4).write(payload.length, 8);
    for (const byte of payload) bits.write(byte, 8);
    const result = decodeSegments(bits.toBytes(), 1);
    expect(result.text).toBe('é!');
  });

  it('honors an ECI charset designator', () => {
    const payload = Uint8Array.from([0xe9]); // é in ISO-8859-1
    const bits = new BitWriter()
      .write(0b0111, 4) // ECI mode
      .write(3, 8) // assignment 3 = ISO-8859-1
      .write(0b0100, 4)
      .write(1, 8)
      .write(0xe9, 8)
      .write(0, 4);
    const result = decodeSegments(bits.toBytes(), 1);
    expect(result.segments[0]).toEqual({ mode: 'eci', assignment: 3 });
    expect(result.text).toBe('é');
    expect(result.bytes).toEqual(payload);
  });

  it('maps every assigned ECI charset to the standard table', () => {
    // AIM ITS/04-023: 4–18 are ISO-8859-(n−2) with 14/19 unassigned. The
    // TextDecoder comparison keeps the expectation independent of any
    // hand-transcribed charset knowledge.
    const cases: Array<[assignment: number, label: string]> = [
      [4, 'iso-8859-2'],
      [7, 'iso-8859-5'],
      [13, 'iso-8859-11'], // Thai — previously mislabelled windows-1250
      [15, 'iso-8859-13'], // previously mislabelled iso-8859-15
      [16, 'iso-8859-14'],
      [17, 'iso-8859-15'], // previously mislabelled iso-8859-16
      [18, 'iso-8859-16'],
      [21, 'windows-1250'],
      [22, 'windows-1251'],
      [24, 'windows-1256'],
    ];
    const payload = Uint8Array.from([0xa4, 0xb5, 0xe9]);
    for (const [assignment, label] of cases) {
      let decoder: TextDecoder;
      try {
        decoder = new TextDecoder(label);
      } catch {
        // Runtime without this converter (Node's ICU lacks e.g. iso-8859-16);
        // decodeBytes() falls back to the heuristic there, browsers decode it.
        continue;
      }
      const bits = new BitWriter()
        .write(0b0111, 4)
        .write(assignment, 8)
        .write(0b0100, 4)
        .write(payload.length, 8);
      for (const byte of payload) bits.write(byte, 8);
      bits.write(0, 4);
      const result = decodeSegments(bits.toBytes(), 1);
      expect(result.text, `ECI ${assignment} must decode as ${label}`).toBe(
        decoder.decode(payload),
      );
    }
  });

  it('falls back to the charset heuristic for unassigned ECI values', () => {
    const payload = new TextEncoder().encode('héllo'); // valid UTF-8
    const bits = new BitWriter()
      .write(0b0111, 4)
      .write(14, 8) // unassigned slot in the ISO-8859 range
      .write(0b0100, 4)
      .write(payload.length, 8);
    for (const byte of payload) bits.write(byte, 8);
    bits.write(0, 4);
    expect(decodeSegments(bits.toBytes(), 1).text).toBe('héllo');
  });

  it('uses wider count fields for larger versions', () => {
    const bits = new BitWriter().write(0b0100, 4).write(2, 16).write(0x41, 8).write(0x42, 8);
    expect(decodeSegments(bits.toBytes(), 10).text).toBe('AB');
    expect(decodeSegments(bits.toBytes(), 40).text).toBe('AB');
  });

  it('parses structured append headers', () => {
    const bits = new BitWriter()
      .write(0b0011, 4)
      .write(1, 4) // index
      .write(3, 4) // total - 1
      .write(0xab, 8) // parity
      .write(0b0001, 4)
      .write(2, 10)
      .write(42, 7)
      .write(0, 4);
    const result = decodeSegments(bits.toBytes(), 1);
    expect(result.structuredAppend).toEqual({ index: 1, total: 4, parity: 0xab });
    expect(result.text).toBe('42');
  });

  it('reports FNC1 in first position (GS1)', () => {
    const bits = new BitWriter().write(0b0101, 4).write(0b0001, 4).write(1, 10).write(7, 4);
    const result = decodeSegments(bits.toBytes(), 1);
    expect(result.fnc1).toEqual({ position: 'first' });
    expect(result.text).toBe('7');
  });

  it('reports the FNC1 second-position application indicator', () => {
    // Two-digit indicators are their value; letters are ASCII + 100.
    const numeric = new BitWriter()
      .write(0b1001, 4)
      .write(42, 8)
      .write(0b0001, 4)
      .write(1, 10)
      .write(7, 4);
    expect(decodeSegments(numeric.toBytes(), 1).fnc1).toEqual({
      position: 'second',
      applicationIndicator: '42',
    });
    const letter = new BitWriter()
      .write(0b1001, 4)
      .write(165, 8)
      .write(0b0001, 4)
      .write(1, 10)
      .write(7, 4);
    expect(decodeSegments(letter.toBytes(), 1).fnc1).toEqual({
      position: 'second',
      applicationIndicator: 'A',
    });
  });

  it('translates alphanumeric % escapes in FNC1 symbols', () => {
    // "10%23" encodes GS-separated element strings: "%" → GS, "%%" → "%".
    const pairs = [
      [1 * 45 + 0, 11], // "10"
      [38 * 45 + 2, 11], // "%2"
      [3, 6], // "3"
    ] as const;
    const gs = new BitWriter().write(0b0101, 4).write(0b0010, 4).write(5, 9);
    for (const [value, width] of pairs) gs.write(value, width);
    gs.write(0, 4);
    expect(decodeSegments(gs.toBytes(), 1).text).toBe('10\x1d23');

    const literal = new BitWriter()
      .write(0b0101, 4)
      .write(0b0010, 4)
      .write(4, 9)
      .write(10 * 45 + 38, 11) // "A%"
      .write(38 * 45 + 11, 11) // "%B"
      .write(0, 4);
    expect(decodeSegments(literal.toBytes(), 1).text).toBe('A%B');

    // Without FNC1, "%" is an ordinary alphanumeric character.
    const plain = new BitWriter().write(0b0010, 4).write(1, 9).write(38, 6).write(0, 4);
    expect(decodeSegments(plain.toBytes(), 1).text).toBe('%');
  });

  it('decodes Kanji mode via the Shift-JIS mapping', () => {
    // Spec §8.4.7 examples: 0x935F (点) → 3487, 0xE4AA (茗) → 6826.
    const bits = new BitWriter()
      .write(0b1000, 4)
      .write(2, 8)
      .write(3487, 13)
      .write(6826, 13)
      .write(0, 4);
    const result = decodeSegments(bits.toBytes(), 1);
    expect(result.text).toBe('点茗');
    expect(result.segments[0]).toEqual({
      mode: 'kanji',
      bytes: Uint8Array.from([0x93, 0x5f, 0xe4, 0xaa]),
      text: '点茗',
    });
    expect(result.bytes).toEqual(Uint8Array.from([0x93, 0x5f, 0xe4, 0xaa]));
  });

  it('rejects a Kanji segment that overruns the stream', () => {
    const bits = new BitWriter().write(0b1000, 4).write(2, 8).write(3487, 13);
    expect(() => decodeSegments(bits.toBytes(), 1)).toThrow(DecodeError);
  });

  it('stops at the terminator and at exhausted input', () => {
    const bits = new BitWriter()
      .write(0b0001, 4)
      .write(1, 10)
      .write(5, 4)
      .write(0, 4)
      .write(0b0100, 4);
    expect(decodeSegments(bits.toBytes(), 1).text).toBe('5');
    const noTerminator = new BitWriter().write(0b0001, 4).write(1, 10).write(5, 4);
    expect(decodeSegments(noTerminator.toBytes(), 1).text).toBe('5');
  });

  it('rejects overlong numeric values', () => {
    const bits = new BitWriter().write(0b0001, 4).write(3, 10).write(1000, 10);
    expect(() => decodeSegments(bits.toBytes(), 1)).toThrow(DecodeError);
  });

  it('throws DecodeError (never RangeError) when a segment overruns the stream', () => {
    // Miscorrected Reed–Solomon blocks can produce arbitrary garbage that
    // reaches the segment decoder; every overrun must surface as a
    // DecodeError so decode() keeps its return-null contract.
    const truncated: Array<[name: string, bits: BitWriter, version: number]> = [
      // Numeric count claims 63 digits, then the stream ends.
      ['numeric payload', new BitWriter().write(0b0001, 4).write(63, 10), 1],
      // Alphanumeric count claims 40 characters with 2 bits of payload left.
      ['alphanumeric payload', new BitWriter().write(0b0010, 4).write(40, 9), 1],
      // Byte-mode 16-bit count field cut off after 4 bits (version 10+).
      ['count field', new BitWriter().write(0b0100, 4).write(0xf, 4), 10],
      // Structured-append header cut off after the index nibble.
      ['structured append header', new BitWriter().write(0b0011, 4), 1],
      // FNC1 second position missing its application indicator byte.
      ['fnc1 application indicator', new BitWriter().write(0b1001, 4), 1],
    ];
    for (const [name, bits, version] of truncated) {
      let caught: unknown = null;
      try {
        decodeSegments(bits.toBytes(), version);
      } catch (error) {
        caught = error;
      }
      expect(caught, `${name} must throw`).not.toBeNull();
      expect(caught, `${name} must throw DecodeError`).toBeInstanceOf(DecodeError);
      expect((caught as DecodeError).code, name).toBe('bitstream');
    }
  });
});
