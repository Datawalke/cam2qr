/**
 * Best-effort classification of common QR payload conventions. Pure string
 * processing — never throws; unrecognized payloads come back as
 * `{ type: 'text' }`.
 */
export type ParsedContent =
  | { type: 'url'; url: string }
  | {
      type: 'wifi';
      ssid: string;
      password?: string;
      security?: 'WEP' | 'WPA' | 'WPA2-EAP' | 'nopass';
      hidden?: boolean;
    }
  | { type: 'geo'; latitude: number; longitude: number; altitude?: number }
  | { type: 'tel'; number: string }
  | { type: 'sms'; number: string; message?: string }
  | { type: 'email'; to: string; subject?: string; body?: string }
  | { type: 'vcard'; raw: string; name?: string; org?: string; tel?: string; email?: string }
  | { type: 'gs1'; raw: string; elements: Array<{ ai: string; value: string }> }
  | { type: 'text'; text: string };

export interface ParseContentHints {
  /** The symbol carried FNC1 in first position (GS1-formatted data). */
  gs1?: boolean;
}

export function parseContent(text: string, hints: ParseContentHints = {}): ParsedContent {
  return (
    (hints.gs1 === true ? parseGs1(text) : null) ??
    parseWifi(text) ??
    parseGeo(text) ??
    parseTel(text) ??
    parseSms(text) ??
    parseEmail(text) ??
    parseVCard(text) ??
    parseUrl(text) ?? { type: 'text', text }
  );
}

/**
 * Splits a GS1 element string into (application identifier, value) pairs.
 * Fixed-length AIs come from the GS1 predefined-length table; everything
 * else reads to the next GS separator (0x1D). Best-effort: uncommon 3/4-digit
 * variable AIs outside the known prefix ranges fall back to a 2-digit split.
 */
function parseGs1(text: string): ParsedContent | null {
  const elements: Array<{ ai: string; value: string }> = [];
  let pos = 0;
  while (pos < text.length) {
    if (text[pos] === '\x1d') {
      pos++;
      continue;
    }
    const two = text.slice(pos, pos + 2);
    if (!/^\d\d$/.test(two)) return null;
    const prefix = Number(two);

    let aiLength = 2;
    let valueLength: number | null = null; // null = variable, read to GS
    const fixedTwoDigit: Record<string, number> = {
      '00': 18,
      '01': 14,
      '02': 14,
      '03': 14,
      '04': 16,
      '11': 6,
      '12': 6,
      '13': 6,
      '14': 6,
      '15': 6,
      '16': 6,
      '17': 6,
      '18': 6,
      '19': 6,
      '20': 2,
    };
    if (two in fixedTwoDigit) {
      valueLength = fixedTwoDigit[two]!;
    } else if (prefix >= 31 && prefix <= 36) {
      aiLength = 4; // metric measures, e.g. 3103 = net weight kg, 3 decimals
      valueLength = 6;
    } else if (prefix === 41) {
      aiLength = 3; // 410–419 routing/location codes
      valueLength = 13;
    } else if (prefix === 23 || prefix === 24 || prefix === 25 || prefix === 40 || prefix === 42) {
      aiLength = 3;
    } else if (prefix === 39 || prefix === 43 || (prefix >= 70 && prefix <= 82)) {
      aiLength = 4;
    }

    const ai = text.slice(pos, pos + aiLength);
    if (ai.length < aiLength || !/^\d+$/.test(ai)) return null;
    pos += aiLength;

    let value: string;
    if (valueLength !== null) {
      value = text.slice(pos, pos + valueLength);
      if (value.length < valueLength) return null;
      pos += valueLength;
    } else {
      const gs = text.indexOf('\x1d', pos);
      value = gs === -1 ? text.slice(pos) : text.slice(pos, gs);
      pos += value.length;
    }
    if (value === '') return null;
    elements.push({ ai, value });
  }
  return elements.length > 0 ? { type: 'gs1', raw: text, elements } : null;
}

function parseUrl(text: string): ParsedContent | null {
  if (!/^https?:\/\//i.test(text)) return null;
  try {
    new URL(text);
    return { type: 'url', url: text };
  } catch {
    return null;
  }
}

/** WIFI:T:WPA;S:my ssid;P:secret;H:true;; with \-escaping of ; , : " \ */
function parseWifi(text: string): ParsedContent | null {
  if (!/^WIFI:/i.test(text)) return null;
  const fields = new Map<string, string>();
  let key = '';
  let value = '';
  let inValue = false;
  const body = text.slice(5);
  for (let i = 0; i < body.length; i++) {
    const char = body[i]!;
    if (char === '\\' && i + 1 < body.length) {
      value += body[++i]!;
      continue;
    }
    if (!inValue && char === ':') {
      key = value;
      value = '';
      inValue = true;
    } else if (inValue && char === ';') {
      fields.set(key.toUpperCase(), value);
      value = '';
      inValue = false;
    } else {
      value += char;
    }
  }
  const ssid = fields.get('S');
  if (ssid === undefined || ssid === '') return null;

  const result: ParsedContent = { type: 'wifi', ssid };
  const security = fields.get('T')?.toUpperCase();
  if (security === 'WEP' || security === 'WPA' || security === 'WPA2-EAP') {
    result.security = security;
  } else if (security?.toLowerCase() === 'nopass') {
    result.security = 'nopass';
  }
  const password = fields.get('P');
  if (password !== undefined && password !== '' && result.security !== 'nopass') {
    result.password = password;
  }
  if (fields.get('H')?.toLowerCase() === 'true') result.hidden = true;
  return result;
}

function parseGeo(text: string): ParsedContent | null {
  const match = /^geo:(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)(?:,(-?\d+(?:\.\d+)?))?/i.exec(text);
  if (!match) return null;
  const result: ParsedContent = {
    type: 'geo',
    latitude: Number(match[1]),
    longitude: Number(match[2]),
  };
  if (match[3] !== undefined) result.altitude = Number(match[3]);
  return result;
}

function parseTel(text: string): ParsedContent | null {
  const match = /^tel:(.+)$/i.exec(text);
  return match ? { type: 'tel', number: match[1]! } : null;
}

/** smsto:number:message and sms:number?body=message */
function parseSms(text: string): ParsedContent | null {
  const smsto = /^smsto:([^:]+)(?::([\s\S]*))?$/i.exec(text);
  if (smsto) {
    const result: ParsedContent = { type: 'sms', number: smsto[1]! };
    if (smsto[2]) result.message = smsto[2];
    return result;
  }
  const sms = /^sms:([^?]+)(?:\?body=([\s\S]*))?$/i.exec(text);
  if (sms) {
    const result: ParsedContent = { type: 'sms', number: sms[1]! };
    if (sms[2]) result.message = safeDecodeURIComponent(sms[2]);
    return result;
  }
  return null;
}

/** mailto: URLs and the MATMSG:TO:…;SUB:…;BODY:…;; convention. */
function parseEmail(text: string): ParsedContent | null {
  const mailto = /^mailto:([^?]+)(?:\?([\s\S]*))?$/i.exec(text);
  if (mailto) {
    const result: ParsedContent = { type: 'email', to: safeDecodeURIComponent(mailto[1]!) };
    if (mailto[2]) {
      const params = new URLSearchParams(mailto[2]);
      const subject = params.get('subject');
      const body = params.get('body');
      if (subject) result.subject = subject;
      if (body) result.body = body;
    }
    return result;
  }
  if (/^MATMSG:/i.test(text)) {
    const to = /TO:([^;]*)/i.exec(text)?.[1];
    if (!to) return null;
    const result: ParsedContent = { type: 'email', to };
    const subject = /SUB:([^;]*)/i.exec(text)?.[1];
    const body = /BODY:([^;]*)/i.exec(text)?.[1];
    if (subject) result.subject = subject;
    if (body) result.body = body;
    return result;
  }
  return null;
}

function parseVCard(text: string): ParsedContent | null {
  if (!/^BEGIN:VCARD/i.test(text.trimStart())) return null;
  const result: ParsedContent = { type: 'vcard', raw: text };
  const name = /^FN(?:;[^:]*)?:(.+)$/im.exec(text)?.[1];
  const org = /^ORG(?:;[^:]*)?:(.+)$/im.exec(text)?.[1];
  const tel = /^TEL(?:;[^:]*)?:(.+)$/im.exec(text)?.[1];
  const email = /^EMAIL(?:;[^:]*)?:(.+)$/im.exec(text)?.[1];
  if (name) result.name = name.trim();
  if (org) result.org = org.trim();
  if (tel) result.tel = tel.trim();
  if (email) result.email = email.trim();
  return result;
}

function safeDecodeURIComponent(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}
