import { DecodeError } from '../errors.js';
import type { Fnc1, Segment, StructuredAppend } from '../types.js';
import { BitReader } from './bitstream.js';

const MODE_TERMINATOR = 0b0000;
const MODE_NUMERIC = 0b0001;
const MODE_ALPHANUMERIC = 0b0010;
const MODE_STRUCTURED_APPEND = 0b0011;
const MODE_BYTE = 0b0100;
const MODE_FNC1_FIRST = 0b0101;
const MODE_ECI = 0b0111;
const MODE_KANJI = 0b1000;
const MODE_FNC1_SECOND = 0b1001;

const ALPHANUMERIC_CHARS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ $%*+-./:';

/** Character count indicator width per mode and version (§8.4). */
function countBits(mode: number, version: number): number {
  const index = version <= 9 ? 0 : version <= 26 ? 1 : 2;
  switch (mode) {
    case MODE_NUMERIC:
      return [10, 12, 14][index]!;
    case MODE_ALPHANUMERIC:
      return [9, 11, 13][index]!;
    case MODE_BYTE:
      return [8, 16, 16][index]!;
    case MODE_KANJI:
      return [8, 10, 12][index]!;
    default:
      throw new DecodeError('bitstream', `no count field for mode ${mode}`);
  }
}

/**
 * Maps ECI assignment numbers (AIM ITS/04-023, the table ISO/IEC 18004
 * references) to TextDecoder labels. Assignments 4–18 are the ISO-8859
 * series offset by two (14 and 19 are unassigned); the rest are enumerated.
 * Unknown assignments fall back to the UTF-8 → ISO-8859-1 heuristic.
 */
function eciLabel(assignment: number): string | null {
  if (assignment >= 4 && assignment <= 18 && assignment !== 14) {
    return `iso-8859-${assignment - 2}`;
  }
  switch (assignment) {
    case 1:
    case 3:
      return 'iso-8859-1';
    case 20:
      return 'shift_jis';
    case 21:
      return 'windows-1250';
    case 22:
      return 'windows-1251';
    case 23:
      return 'windows-1252';
    case 24:
      return 'windows-1256';
    case 25:
      return 'utf-16be';
    case 26:
      return 'utf-8';
    case 27:
    case 170:
      return 'ascii';
    case 28:
      return 'big5';
    case 29:
      return 'gb18030';
    case 30:
      return 'euc-kr';
    default:
      return null;
  }
}

/**
 * Decodes byte-mode payload bytes to text. With no ECI in effect, applies the
 * de-facto standard heuristic: strict UTF-8 first, ISO-8859-1 fallback.
 */
function decodeBytes(bytes: Uint8Array, eci: number | null): string {
  if (eci !== null) {
    const label = eciLabel(eci);
    if (label !== null) {
      try {
        return new TextDecoder(label).decode(bytes);
      } catch {
        // Unknown label at runtime — fall through to the heuristic.
      }
    }
  }
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder('iso-8859-1').decode(bytes);
  }
}

// #region snippet: segments
function decodeNumeric(reader: BitReader, count: number): string {
  let result = '';
  let remaining = count;
  while (remaining >= 3) {
    const value = reader.read(10);
    if (value >= 1000) throw new DecodeError('bitstream', 'invalid numeric triple');
    result += value.toString().padStart(3, '0');
    remaining -= 3;
  }
  if (remaining === 2) {
    const value = reader.read(7);
    if (value >= 100) throw new DecodeError('bitstream', 'invalid numeric pair');
    result += value.toString().padStart(2, '0');
  } else if (remaining === 1) {
    const value = reader.read(4);
    if (value >= 10) throw new DecodeError('bitstream', 'invalid numeric digit');
    result += value.toString();
  }
  return result;
}
// #endregion snippet

/**
 * Decodes a Kanji segment: 13-bit packed values → Shift-JIS byte pairs
 * (§8.4.7: ranges 0x8140–0x9FFC and 0xE040–0xEBBF, offset by 0x8140 and
 * 0xC140 respectively).
 */
function decodeKanjiBytes(reader: BitReader, count: number): Uint8Array {
  const bytes = new Uint8Array(count * 2);
  for (let i = 0; i < count; i++) {
    const value = reader.read(13);
    const assembled = (Math.floor(value / 0xc0) << 8) | (value % 0xc0);
    const shiftJis = assembled + (assembled + 0x8140 <= 0x9ffc ? 0x8140 : 0xc140);
    bytes[i * 2] = shiftJis >> 8;
    bytes[i * 2 + 1] = shiftJis & 0xff;
  }
  return bytes;
}

function decodeShiftJis(bytes: Uint8Array): string {
  try {
    return new TextDecoder('shift_jis').decode(bytes);
  } catch {
    throw new DecodeError('unsupported-mode', 'no Shift-JIS decoder available in this runtime');
  }
}

/**
 * In an FNC1 symbol, "%" in alphanumeric segments is an escape: "%%" is a
 * literal percent, a lone "%" is the GS separator (0x1D).
 */
function applyFnc1Escapes(text: string): string {
  return text.replace(/%%|%/g, (match) => (match === '%%' ? '%' : '\x1d'));
}

function decodeAlphanumeric(reader: BitReader, count: number): string {
  let result = '';
  let remaining = count;
  while (remaining >= 2) {
    const value = reader.read(11);
    if (value >= 45 * 45) throw new DecodeError('bitstream', 'invalid alphanumeric pair');
    result += ALPHANUMERIC_CHARS[Math.floor(value / 45)]! + ALPHANUMERIC_CHARS[value % 45]!;
    remaining -= 2;
  }
  if (remaining === 1) {
    const value = reader.read(6);
    if (value >= 45) throw new DecodeError('bitstream', 'invalid alphanumeric character');
    result += ALPHANUMERIC_CHARS[value]!;
  }
  return result;
}

function readEciAssignment(reader: BitReader): number {
  const first = reader.read(8);
  if ((first & 0b1000_0000) === 0) return first & 0b0111_1111;
  if ((first & 0b1100_0000) === 0b1000_0000) {
    return ((first & 0b0011_1111) << 8) | reader.read(8);
  }
  if ((first & 0b1110_0000) === 0b1100_0000) {
    return ((first & 0b0001_1111) << 16) | reader.read(16);
  }
  throw new DecodeError('bitstream', 'invalid ECI designator');
}

export interface DecodedStream {
  text: string;
  bytes: Uint8Array;
  segments: Segment[];
  structuredAppend?: StructuredAppend;
  fnc1?: Fnc1;
}

/**
 * Lazily instantiated so merely importing the library never touches the
 * `TextEncoder` global (absent in some jsdom/SSR/edge/RN environments). Only a
 * decode that hits a numeric or alphanumeric segment needs it.
 */
let textEncoder: TextEncoder | undefined;
function encodeUtf8(text: string): Uint8Array {
  textEncoder ??= new TextEncoder();
  return textEncoder.encode(text);
}

/** Decodes the mode-segmented data bitstream (§8.4) into text and segments. */
export function decodeSegments(data: Uint8Array, version: number): DecodedStream {
  const reader = new BitReader(data);
  const segments: Segment[] = [];
  const byteChunks: Uint8Array[] = [];
  let text = '';
  let eci: number | null = null;
  let structuredAppend: StructuredAppend | undefined;
  let fnc1: Fnc1 | undefined;

  while (reader.available() >= 4) {
    const mode = reader.read(4);
    if (mode === MODE_TERMINATOR) break;

    switch (mode) {
      case MODE_NUMERIC: {
        const count = reader.read(countBits(mode, version));
        const decoded = decodeNumeric(reader, count);
        segments.push({ mode: 'numeric', text: decoded });
        text += decoded;
        byteChunks.push(encodeUtf8(decoded));
        break;
      }
      case MODE_ALPHANUMERIC: {
        const count = reader.read(countBits(mode, version));
        let decoded = decodeAlphanumeric(reader, count);
        if (fnc1 !== undefined) decoded = applyFnc1Escapes(decoded);
        segments.push({ mode: 'alphanumeric', text: decoded });
        text += decoded;
        byteChunks.push(encodeUtf8(decoded));
        break;
      }
      case MODE_BYTE: {
        const count = reader.read(countBits(mode, version));
        if (reader.available() < 8 * count) {
          throw new DecodeError('bitstream', 'byte segment overruns data');
        }
        const bytes = new Uint8Array(count);
        for (let i = 0; i < count; i++) bytes[i] = reader.read(8);
        const decoded = decodeBytes(bytes, eci);
        segments.push({ mode: 'byte', bytes, text: decoded });
        text += decoded;
        byteChunks.push(bytes);
        break;
      }
      case MODE_ECI: {
        eci = readEciAssignment(reader);
        segments.push({ mode: 'eci', assignment: eci });
        break;
      }
      case MODE_STRUCTURED_APPEND: {
        structuredAppend = {
          index: reader.read(4),
          total: reader.read(4) + 1,
          parity: reader.read(8),
        };
        break;
      }
      case MODE_FNC1_FIRST: {
        fnc1 = { position: 'first' };
        break;
      }
      case MODE_FNC1_SECOND: {
        // Application indicator: a two-digit number as its value, or a
        // single letter as its ASCII code plus 100.
        const indicator = reader.read(8);
        fnc1 = {
          position: 'second',
          applicationIndicator:
            indicator >= 100 && indicator <= 226
              ? String.fromCharCode(indicator - 100)
              : String(indicator).padStart(2, '0'),
        };
        break;
      }
      case MODE_KANJI: {
        const count = reader.read(countBits(mode, version));
        if (reader.available() < 13 * count) {
          throw new DecodeError('bitstream', 'kanji segment overruns data');
        }
        const bytes = decodeKanjiBytes(reader, count);
        const decoded = decodeShiftJis(bytes);
        segments.push({ mode: 'kanji', bytes, text: decoded });
        text += decoded;
        byteChunks.push(bytes);
        break;
      }
      default:
        throw new DecodeError('bitstream', `unknown mode indicator ${mode}`);
    }
  }

  const totalBytes = byteChunks.reduce((sum, c) => sum + c.length, 0);
  const bytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of byteChunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }

  const result: DecodedStream = { text, bytes, segments };
  if (structuredAppend !== undefined) result.structuredAppend = structuredAppend;
  if (fnc1 !== undefined) result.fnc1 = fnc1;
  return result;
}
