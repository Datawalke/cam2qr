// src/content/parse.ts
function parseContent(text, hints = {}) {
  return (hints.gs1 === true ? parseGs1(text) : null) ?? parseWifi(text) ?? parseGeo(text) ?? parseTel(text) ?? parseSms(text) ?? parseEmail(text) ?? parseVCard(text) ?? parseUrl(text) ?? { type: "text", text };
}
function parseGs1(text) {
  const elements = [];
  let pos = 0;
  while (pos < text.length) {
    if (text[pos] === "") {
      pos++;
      continue;
    }
    const two = text.slice(pos, pos + 2);
    if (!/^\d\d$/.test(two)) return null;
    const prefix = Number(two);
    let aiLength = 2;
    let valueLength = null;
    const fixedTwoDigit = {
      "00": 18,
      "01": 14,
      "02": 14,
      "03": 14,
      "04": 16,
      "11": 6,
      "12": 6,
      "13": 6,
      "14": 6,
      "15": 6,
      "16": 6,
      "17": 6,
      "18": 6,
      "19": 6,
      "20": 2
    };
    if (two in fixedTwoDigit) {
      valueLength = fixedTwoDigit[two];
    } else if (prefix >= 31 && prefix <= 36) {
      aiLength = 4;
      valueLength = 6;
    } else if (prefix === 41) {
      aiLength = 3;
      valueLength = 13;
    } else if (prefix === 23 || prefix === 24 || prefix === 25 || prefix === 40 || prefix === 42) {
      aiLength = 3;
    } else if (prefix === 39 || prefix === 43 || prefix >= 70 && prefix <= 82) {
      aiLength = 4;
    }
    const ai = text.slice(pos, pos + aiLength);
    if (ai.length < aiLength || !/^\d+$/.test(ai)) return null;
    pos += aiLength;
    let value;
    if (valueLength !== null) {
      value = text.slice(pos, pos + valueLength);
      if (value.length < valueLength) return null;
      pos += valueLength;
    } else {
      const gs = text.indexOf("", pos);
      value = gs === -1 ? text.slice(pos) : text.slice(pos, gs);
      pos += value.length;
    }
    if (value === "") return null;
    elements.push({ ai, value });
  }
  return elements.length > 0 ? { type: "gs1", raw: text, elements } : null;
}
function parseUrl(text) {
  if (!/^https?:\/\//i.test(text)) return null;
  try {
    new URL(text);
    return { type: "url", url: text };
  } catch {
    return null;
  }
}
function parseWifi(text) {
  if (!/^WIFI:/i.test(text)) return null;
  const fields = /* @__PURE__ */ new Map();
  let key = "";
  let value = "";
  let inValue = false;
  const body = text.slice(5);
  for (let i = 0; i < body.length; i++) {
    const char = body[i];
    if (char === "\\" && i + 1 < body.length) {
      value += body[++i];
      continue;
    }
    if (!inValue && char === ":") {
      key = value;
      value = "";
      inValue = true;
    } else if (inValue && char === ";") {
      fields.set(key.toUpperCase(), value);
      value = "";
      inValue = false;
    } else {
      value += char;
    }
  }
  const ssid = fields.get("S");
  if (ssid === void 0 || ssid === "") return null;
  const result = { type: "wifi", ssid };
  const security = fields.get("T")?.toUpperCase();
  if (security === "WEP" || security === "WPA" || security === "WPA2-EAP") {
    result.security = security;
  } else if (security?.toLowerCase() === "nopass") {
    result.security = "nopass";
  }
  const password = fields.get("P");
  if (password !== void 0 && password !== "" && result.security !== "nopass") {
    result.password = password;
  }
  if (fields.get("H")?.toLowerCase() === "true") result.hidden = true;
  return result;
}
function parseGeo(text) {
  const match = /^geo:(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)(?:,(-?\d+(?:\.\d+)?))?/i.exec(text);
  if (!match) return null;
  const result = {
    type: "geo",
    latitude: Number(match[1]),
    longitude: Number(match[2])
  };
  if (match[3] !== void 0) result.altitude = Number(match[3]);
  return result;
}
function parseTel(text) {
  const match = /^tel:(.+)$/i.exec(text);
  return match ? { type: "tel", number: match[1] } : null;
}
function parseSms(text) {
  const smsto = /^smsto:([^:]+)(?::([\s\S]*))?$/i.exec(text);
  if (smsto) {
    const result = { type: "sms", number: smsto[1] };
    if (smsto[2]) result.message = smsto[2];
    return result;
  }
  const sms = /^sms:([^?]+)(?:\?body=([\s\S]*))?$/i.exec(text);
  if (sms) {
    const result = { type: "sms", number: sms[1] };
    if (sms[2]) result.message = safeDecodeURIComponent(sms[2]);
    return result;
  }
  return null;
}
function parseEmail(text) {
  const mailto = /^mailto:([^?]+)(?:\?([\s\S]*))?$/i.exec(text);
  if (mailto) {
    const result = { type: "email", to: safeDecodeURIComponent(mailto[1]) };
    if (mailto[2]) {
      const params = new URLSearchParams(mailto[2]);
      const subject = params.get("subject");
      const body = params.get("body");
      if (subject) result.subject = subject;
      if (body) result.body = body;
    }
    return result;
  }
  if (/^MATMSG:/i.test(text)) {
    const to = /TO:([^;]*)/i.exec(text)?.[1];
    if (!to) return null;
    const result = { type: "email", to };
    const subject = /SUB:([^;]*)/i.exec(text)?.[1];
    const body = /BODY:([^;]*)/i.exec(text)?.[1];
    if (subject) result.subject = subject;
    if (body) result.body = body;
    return result;
  }
  return null;
}
function parseVCard(text) {
  if (!/^BEGIN:VCARD/i.test(text.trimStart())) return null;
  const result = { type: "vcard", raw: text };
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
function safeDecodeURIComponent(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

// src/core/bit-matrix.ts
var BitMatrix = class _BitMatrix {
  constructor(size, bits) {
    if (bits !== void 0 && bits.length !== size * size) {
      throw new Error(`bit buffer length ${bits.length} does not match size ${size}`);
    }
    this.size = size;
    this.bits = bits ?? new Uint8Array(size * size);
  }
  get(x, y) {
    return this.bits[y * this.size + x] !== 0;
  }
  set(x, y, value) {
    this.bits[y * this.size + x] = value ? 1 : 0;
  }
  /** Marks a width×height region starting at (left, top). */
  setRegion(left, top, width, height) {
    for (let y = top; y < top + height; y++) {
      for (let x = left; x < left + width; x++) {
        this.bits[y * this.size + x] = 1;
      }
    }
  }
  clone() {
    return new _BitMatrix(this.size, this.bits.slice());
  }
};

// src/errors.ts
var DecodeError = class extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
    this.name = "DecodeError";
  }
};

// src/core/version.ts
function versionForSize(size) {
  if (size < 21 || size > 177 || (size - 17) % 4 !== 0) return null;
  return (size - 17) / 4;
}
function sizeForVersion(version) {
  return version * 4 + 17;
}
var ECC_TABLE = [
  /*  1 */
  [
    [7, 1, 19],
    [10, 1, 16],
    [13, 1, 13],
    [17, 1, 9]
  ],
  /*  2 */
  [
    [10, 1, 34],
    [16, 1, 28],
    [22, 1, 22],
    [28, 1, 16]
  ],
  /*  3 */
  [
    [15, 1, 55],
    [26, 1, 44],
    [18, 2, 17],
    [22, 2, 13]
  ],
  /*  4 */
  [
    [20, 1, 80],
    [18, 2, 32],
    [26, 2, 24],
    [16, 4, 9]
  ],
  /*  5 */
  [
    [26, 1, 108],
    [24, 2, 43],
    [18, 2, 15, 2, 16],
    [22, 2, 11, 2, 12]
  ],
  /*  6 */
  [
    [18, 2, 68],
    [16, 4, 27],
    [24, 4, 19],
    [28, 4, 15]
  ],
  /*  7 */
  [
    [20, 2, 78],
    [18, 4, 31],
    [18, 2, 14, 4, 15],
    [26, 4, 13, 1, 14]
  ],
  /*  8 */
  [
    [24, 2, 97],
    [22, 2, 38, 2, 39],
    [22, 4, 18, 2, 19],
    [26, 4, 14, 2, 15]
  ],
  /*  9 */
  [
    [30, 2, 116],
    [22, 3, 36, 2, 37],
    [20, 4, 16, 4, 17],
    [24, 4, 12, 4, 13]
  ],
  /* 10 */
  [
    [18, 2, 68, 2, 69],
    [26, 4, 43, 1, 44],
    [24, 6, 19, 2, 20],
    [28, 6, 15, 2, 16]
  ],
  /* 11 */
  [
    [20, 4, 81],
    [30, 1, 50, 4, 51],
    [28, 4, 22, 4, 23],
    [24, 3, 12, 8, 13]
  ],
  /* 12 */
  [
    [24, 2, 92, 2, 93],
    [22, 6, 36, 2, 37],
    [26, 4, 20, 6, 21],
    [28, 7, 14, 4, 15]
  ],
  /* 13 */
  [
    [26, 4, 107],
    [22, 8, 37, 1, 38],
    [24, 8, 20, 4, 21],
    [22, 12, 11, 4, 12]
  ],
  /* 14 */
  [
    [30, 3, 115, 1, 116],
    [24, 4, 40, 5, 41],
    [20, 11, 16, 5, 17],
    [24, 11, 12, 5, 13]
  ],
  /* 15 */
  [
    [22, 5, 87, 1, 88],
    [24, 5, 41, 5, 42],
    [30, 5, 24, 7, 25],
    [24, 11, 12, 7, 13]
  ],
  /* 16 */
  [
    [24, 5, 98, 1, 99],
    [28, 7, 45, 3, 46],
    [24, 15, 19, 2, 20],
    [30, 3, 15, 13, 16]
  ],
  /* 17 */
  [
    [28, 1, 107, 5, 108],
    [28, 10, 46, 1, 47],
    [28, 1, 22, 15, 23],
    [28, 2, 14, 17, 15]
  ],
  /* 18 */
  [
    [30, 5, 120, 1, 121],
    [26, 9, 43, 4, 44],
    [28, 17, 22, 1, 23],
    [28, 2, 14, 19, 15]
  ],
  /* 19 */
  [
    [28, 3, 113, 4, 114],
    [26, 3, 44, 11, 45],
    [26, 17, 21, 4, 22],
    [26, 9, 13, 16, 14]
  ],
  /* 20 */
  [
    [28, 3, 107, 5, 108],
    [26, 3, 41, 13, 42],
    [30, 15, 24, 5, 25],
    [28, 15, 15, 10, 16]
  ],
  /* 21 */
  [
    [28, 4, 116, 4, 117],
    [26, 17, 42],
    [28, 17, 22, 6, 23],
    [30, 19, 16, 6, 17]
  ],
  /* 22 */
  [
    [28, 2, 111, 7, 112],
    [28, 17, 46],
    [30, 7, 24, 16, 25],
    [24, 34, 13]
  ],
  /* 23 */
  [
    [30, 4, 121, 5, 122],
    [28, 4, 47, 14, 48],
    [30, 11, 24, 14, 25],
    [30, 16, 15, 14, 16]
  ],
  /* 24 */
  [
    [30, 6, 117, 4, 118],
    [28, 6, 45, 14, 46],
    [30, 11, 24, 16, 25],
    [30, 30, 16, 2, 17]
  ],
  /* 25 */
  [
    [26, 8, 106, 4, 107],
    [28, 8, 47, 13, 48],
    [30, 7, 24, 22, 25],
    [30, 22, 15, 13, 16]
  ],
  /* 26 */
  [
    [28, 10, 114, 2, 115],
    [28, 19, 46, 4, 47],
    [28, 28, 22, 6, 23],
    [30, 33, 16, 4, 17]
  ],
  /* 27 */
  [
    [30, 8, 122, 4, 123],
    [28, 22, 45, 3, 46],
    [30, 8, 23, 26, 24],
    [30, 12, 15, 28, 16]
  ],
  /* 28 */
  [
    [30, 3, 117, 10, 118],
    [28, 3, 45, 23, 46],
    [30, 4, 24, 31, 25],
    [30, 11, 15, 31, 16]
  ],
  /* 29 */
  [
    [30, 7, 116, 7, 117],
    [28, 21, 45, 7, 46],
    [30, 1, 23, 37, 24],
    [30, 19, 15, 26, 16]
  ],
  /* 30 */
  [
    [30, 5, 115, 10, 116],
    [28, 19, 47, 10, 48],
    [30, 15, 24, 25, 25],
    [30, 23, 15, 25, 16]
  ],
  /* 31 */
  [
    [30, 13, 115, 3, 116],
    [28, 2, 46, 29, 47],
    [30, 42, 24, 1, 25],
    [30, 23, 15, 28, 16]
  ],
  /* 32 */
  [
    [30, 17, 115],
    [28, 10, 46, 23, 47],
    [30, 10, 24, 35, 25],
    [30, 19, 15, 35, 16]
  ],
  /* 33 */
  [
    [30, 17, 115, 1, 116],
    [28, 14, 46, 21, 47],
    [30, 29, 24, 19, 25],
    [30, 11, 15, 46, 16]
  ],
  /* 34 */
  [
    [30, 13, 115, 6, 116],
    [28, 14, 46, 23, 47],
    [30, 44, 24, 7, 25],
    [30, 59, 16, 1, 17]
  ],
  /* 35 */
  [
    [30, 12, 121, 7, 122],
    [28, 12, 47, 26, 48],
    [30, 39, 24, 14, 25],
    [30, 22, 15, 41, 16]
  ],
  /* 36 */
  [
    [30, 6, 121, 14, 122],
    [28, 6, 47, 34, 48],
    [30, 46, 24, 10, 25],
    [30, 2, 15, 64, 16]
  ],
  /* 37 */
  [
    [30, 17, 122, 4, 123],
    [28, 29, 46, 14, 47],
    [30, 49, 24, 10, 25],
    [30, 24, 15, 46, 16]
  ],
  /* 38 */
  [
    [30, 4, 122, 18, 123],
    [28, 13, 46, 32, 47],
    [30, 48, 24, 14, 25],
    [30, 42, 15, 32, 16]
  ],
  /* 39 */
  [
    [30, 20, 117, 4, 118],
    [28, 40, 47, 7, 48],
    [30, 43, 24, 22, 25],
    [30, 10, 15, 67, 16]
  ],
  /* 40 */
  [
    [30, 19, 118, 6, 119],
    [28, 18, 47, 31, 48],
    [30, 34, 24, 34, 25],
    [30, 20, 15, 61, 16]
  ]
];
var ALIGNMENT_POSITIONS = [
  /*  1 */
  [],
  /*  2 */
  [6, 18],
  /*  3 */
  [6, 22],
  /*  4 */
  [6, 26],
  /*  5 */
  [6, 30],
  /*  6 */
  [6, 34],
  /*  7 */
  [6, 22, 38],
  /*  8 */
  [6, 24, 42],
  /*  9 */
  [6, 26, 46],
  /* 10 */
  [6, 28, 50],
  /* 11 */
  [6, 30, 54],
  /* 12 */
  [6, 32, 58],
  /* 13 */
  [6, 34, 62],
  /* 14 */
  [6, 26, 46, 66],
  /* 15 */
  [6, 26, 48, 70],
  /* 16 */
  [6, 26, 50, 74],
  /* 17 */
  [6, 30, 54, 78],
  /* 18 */
  [6, 30, 56, 82],
  /* 19 */
  [6, 30, 58, 86],
  /* 20 */
  [6, 34, 62, 90],
  /* 21 */
  [6, 28, 50, 72, 94],
  /* 22 */
  [6, 26, 50, 74, 98],
  /* 23 */
  [6, 30, 54, 78, 102],
  /* 24 */
  [6, 28, 54, 80, 106],
  /* 25 */
  [6, 32, 58, 84, 110],
  /* 26 */
  [6, 30, 58, 86, 114],
  /* 27 */
  [6, 34, 62, 90, 118],
  /* 28 */
  [6, 26, 50, 74, 98, 122],
  /* 29 */
  [6, 30, 54, 78, 102, 126],
  /* 30 */
  [6, 26, 52, 78, 104, 130],
  /* 31 */
  [6, 30, 56, 82, 108, 134],
  /* 32 */
  [6, 34, 60, 86, 112, 138],
  /* 33 */
  [6, 30, 58, 86, 114, 142],
  /* 34 */
  [6, 34, 62, 90, 118, 146],
  /* 35 */
  [6, 30, 54, 78, 102, 126, 150],
  /* 36 */
  [6, 24, 50, 76, 102, 128, 154],
  /* 37 */
  [6, 28, 54, 80, 106, 132, 158],
  /* 38 */
  [6, 32, 58, 84, 110, 136, 162],
  /* 39 */
  [6, 26, 54, 82, 110, 138, 166],
  /* 40 */
  [6, 30, 58, 86, 114, 142, 170]
];
function parseRow(row) {
  const groups = [{ count: row[1], dataCodewords: row[2] }];
  if (row.length === 5) groups.push({ count: row[3], dataCodewords: row[4] });
  return { ecCodewordsPerBlock: row[0], groups };
}
var VERSIONS = ECC_TABLE.map((levels, i) => ({
  version: i + 1,
  size: sizeForVersion(i + 1),
  alignmentPositions: ALIGNMENT_POSITIONS[i],
  ecBlocks: {
    L: parseRow(levels[0]),
    M: parseRow(levels[1]),
    Q: parseRow(levels[2]),
    H: parseRow(levels[3])
  }
}));
function getVersionInfo(version) {
  const info = VERSIONS[version - 1];
  if (info === void 0) throw new RangeError(`invalid QR version ${version}`);
  return info;
}

// src/core/function-pattern.ts
function buildFunctionPatternMap(version) {
  const info = getVersionInfo(version);
  const size = info.size;
  const map = new BitMatrix(size);
  map.setRegion(0, 0, 9, 9);
  map.setRegion(size - 8, 0, 8, 9);
  map.setRegion(0, size - 8, 9, 8);
  const positions = info.alignmentPositions;
  const max = positions.length - 1;
  for (let i = 0; i < positions.length; i++) {
    for (let j = 0; j < positions.length; j++) {
      const overlapsFinder = i === 0 && j === 0 || i === 0 && j === max || i === max && j === 0;
      if (overlapsFinder) continue;
      map.setRegion(positions[j] - 2, positions[i] - 2, 5, 5);
    }
  }
  map.setRegion(6, 9, 1, size - 17);
  map.setRegion(9, 6, size - 17, 1);
  if (version >= 7) {
    map.setRegion(size - 11, 0, 3, 6);
    map.setRegion(0, size - 11, 6, 3);
  }
  return map;
}

// src/core/mask.ts
function maskBit(mask, row, col) {
  switch (mask) {
    case 0:
      return (row + col) % 2 === 0;
    case 1:
      return row % 2 === 0;
    case 2:
      return col % 3 === 0;
    case 3:
      return (row + col) % 3 === 0;
    case 4:
      return (Math.floor(row / 2) + Math.floor(col / 3)) % 2 === 0;
    case 5:
      return row * col % 2 + row * col % 3 === 0;
    case 6:
      return (row * col % 2 + row * col % 3) % 2 === 0;
    case 7:
      return ((row + col) % 2 + row * col % 3) % 2 === 0;
    default:
      throw new RangeError(`invalid mask pattern ${mask}`);
  }
}

// src/core/gf256.ts
var PRIMITIVE = 285;
var ORDER = 255;
var antilog = new Uint8Array(ORDER * 2);
var logOf = new Uint8Array(256);
{
  let value = 1;
  for (let e = 0; e < ORDER; e++) {
    antilog[e] = value;
    antilog[e + ORDER] = value;
    logOf[value] = e;
    value <<= 1;
    if (value & 256) value ^= PRIMITIVE;
  }
}
function alphaPow(e) {
  return antilog[(e % ORDER + ORDER) % ORDER];
}
function gfMul(a, b) {
  if (a === 0 || b === 0) return 0;
  return antilog[logOf[a] + logOf[b]];
}
function gfDiv(a, b) {
  if (b === 0) throw new RangeError("division by zero in GF(256)");
  if (a === 0) return 0;
  return antilog[logOf[a] + ORDER - logOf[b]];
}
function polyEval(p, x) {
  let acc = 0;
  for (let i = p.length - 1; i >= 0; i--) {
    acc = gfMul(acc, x) ^ p[i];
  }
  return acc;
}
function polyMulAddInto(target, addend, scale, shift) {
  const limit = Math.min(addend.length, target.length - shift);
  for (let i = 0; i < limit; i++) {
    target[i + shift] ^= gfMul(scale, addend[i]);
  }
}

// src/core/reed-solomon.ts
function rsCorrect(codewords, ecCount) {
  const length = codewords.length;
  const syndromes = new Uint8Array(ecCount);
  let damaged = false;
  for (let j = 0; j < ecCount; j++) {
    const point = alphaPow(j);
    let acc = 0;
    for (let i = 0; i < length; i++) {
      acc = gfMul(acc, point) ^ codewords[i];
    }
    syndromes[j] = acc;
    if (acc !== 0) damaged = true;
  }
  if (!damaged) return 0;
  const locator = berlekampMassey(syndromes);
  const errorCount = locatorDegree(locator);
  if (2 * errorCount > ecCount) {
    throw new DecodeError("reed-solomon", "block damage exceeds correction capacity");
  }
  const errorDegrees = [];
  for (let k = 0; k < length; k++) {
    if (polyEval(locator, alphaPow(-k)) === 0) errorDegrees.push(k);
  }
  if (errorDegrees.length !== errorCount) {
    throw new DecodeError("reed-solomon", "could not locate all codeword errors");
  }
  const evaluator = new Uint8Array(ecCount);
  for (let i = 0; i < locator.length; i++) {
    if (locator[i] !== 0) polyMulAddInto(evaluator, syndromes, locator[i], i);
  }
  for (const k of errorDegrees) {
    const inverse = alphaPow(-k);
    let slope = 0;
    for (let i = 1; i < locator.length; i += 2) {
      if (locator[i] !== 0) slope ^= gfMul(locator[i], alphaPow(-k * (i - 1)));
    }
    if (slope === 0) {
      throw new DecodeError("reed-solomon", "inconsistent error location in block");
    }
    const magnitude = gfMul(alphaPow(k), gfDiv(polyEval(evaluator, inverse), slope));
    codewords[length - 1 - k] ^= magnitude;
  }
  return errorCount;
}
function berlekampMassey(syndromes) {
  const rounds = syndromes.length;
  const current = new Uint8Array(rounds + 1);
  let fallback = new Uint8Array(rounds + 1);
  current[0] = 1;
  fallback[0] = 1;
  let lfsrLength = 0;
  let sinceChange = 1;
  let changeDelta = 1;
  for (let round = 0; round < rounds; round++) {
    let delta = syndromes[round];
    for (let i = 1; i <= lfsrLength; i++) {
      delta ^= gfMul(current[i], syndromes[round - i]);
    }
    if (delta === 0) {
      sinceChange++;
      continue;
    }
    const grows = 2 * lfsrLength <= round;
    const snapshot = grows ? current.slice() : void 0;
    polyMulAddInto(current, fallback, gfDiv(delta, changeDelta), sinceChange);
    if (grows) {
      lfsrLength = round + 1 - lfsrLength;
      fallback = snapshot;
      changeDelta = delta;
      sinceChange = 1;
    } else {
      sinceChange++;
    }
  }
  return current.subarray(0, lfsrLength + 1);
}
function locatorDegree(locator) {
  for (let i = locator.length - 1; i > 0; i--) {
    if (locator[i] !== 0) return i;
  }
  return 0;
}

// src/core/codewords.ts
function readCodewords(matrix, version, mask) {
  const size = matrix.size;
  const functionModules = buildFunctionPatternMap(version);
  const columns = [];
  for (let x = size - 1; x >= 0; x--) {
    if (x !== 6) columns.push(x);
  }
  const bytes = [];
  let acc = 0;
  let bitCount = 0;
  const visit = (x, y) => {
    if (functionModules.get(x, y)) return;
    const bit = matrix.get(x, y) !== maskBit(mask, y, x);
    acc = acc << 1 | (bit ? 1 : 0);
    if (++bitCount === 8) {
      bytes.push(acc);
      acc = 0;
      bitCount = 0;
    }
  };
  for (let band = 0; band < columns.length; band += 2) {
    const rightX = columns[band];
    const leftX = columns[band + 1];
    const upward = (band & 2) === 0;
    for (let step = 0; step < size; step++) {
      const y = upward ? size - 1 - step : step;
      visit(rightX, y);
      visit(leftX, y);
    }
  }
  return Uint8Array.from(bytes);
}
function correctAndExtractData(raw, version, level) {
  const { ecCodewordsPerBlock, groups } = getVersionInfo(version).ecBlocks[level];
  const dataLengths = [];
  for (const group of groups) {
    for (let i = 0; i < group.count; i++) dataLengths.push(group.dataCodewords);
  }
  const blockCount = dataLengths.length;
  const totalData = dataLengths.reduce((sum, len) => sum + len, 0);
  const totalCodewords = totalData + blockCount * ecCodewordsPerBlock;
  if (raw.length !== totalCodewords) {
    throw new DecodeError(
      "codewords",
      `read ${raw.length} codewords, version ${version}${level} carries ${totalCodewords}`
    );
  }
  const blocks = dataLengths.map((len) => new Uint8Array(len + ecCodewordsPerBlock));
  let cursor = 0;
  const longestData = Math.max(...dataLengths);
  for (let round = 0; round < longestData; round++) {
    for (let b = 0; b < blockCount; b++) {
      if (round < dataLengths[b]) blocks[b][round] = raw[cursor++];
    }
  }
  for (let round = 0; round < ecCodewordsPerBlock; round++) {
    for (let b = 0; b < blockCount; b++) {
      blocks[b][dataLengths[b] + round] = raw[cursor++];
    }
  }
  const bytes = new Uint8Array(totalData);
  let codewordsCorrected = 0;
  let offset = 0;
  for (let b = 0; b < blockCount; b++) {
    codewordsCorrected += rsCorrect(blocks[b], ecCodewordsPerBlock);
    bytes.set(blocks[b].subarray(0, dataLengths[b]), offset);
    offset += dataLengths[b];
  }
  return { bytes, blocks: blockCount, codewordsCorrected };
}

// src/core/bch.ts
function bchRemainder(value, generator) {
  const generatorDegree = 31 - Math.clz32(generator);
  let remainder = value << generatorDegree;
  while (31 - Math.clz32(remainder) >= generatorDegree && remainder !== 0) {
    remainder ^= generator << 31 - Math.clz32(remainder) - generatorDegree;
  }
  return remainder;
}
var FORMAT_GENERATOR = 1335;
var FORMAT_MASK = 21522;
var VERSION_GENERATOR = 7973;
function encodeFormatInfo(data) {
  return (data << 10 | bchRemainder(data, FORMAT_GENERATOR)) ^ FORMAT_MASK;
}
function encodeVersionInfo(version) {
  return version << 12 | bchRemainder(version, VERSION_GENERATOR);
}
function hammingDistance(a, b) {
  let x = a ^ b;
  let count = 0;
  while (x !== 0) {
    x &= x - 1;
    count++;
  }
  return count;
}
function decodeNearest(bits, secondBits, candidates, maxDistance) {
  let bestData = null;
  let bestNearest = maxDistance + 1;
  let bestTotal = Number.POSITIVE_INFINITY;
  for (const [data, codeword] of candidates) {
    const first = hammingDistance(bits, codeword);
    const second = secondBits === null ? first : hammingDistance(secondBits, codeword);
    const nearest = Math.min(first, second);
    const total = first + second;
    if (nearest < bestNearest || nearest === bestNearest && total < bestTotal) {
      bestNearest = nearest;
      bestTotal = total;
      bestData = data;
    }
  }
  return bestNearest <= maxDistance ? bestData : null;
}
var FORMAT_TABLE = Array.from(
  { length: 32 },
  (_, data) => [data, encodeFormatInfo(data)]
);
var VERSION_TABLE = Array.from(
  { length: 34 },
  (_, i) => [i + 7, encodeVersionInfo(i + 7)]
);
function decodeFormatBits(bits, secondBits) {
  return decodeNearest(bits, secondBits ?? null, FORMAT_TABLE, 3);
}
function decodeVersionBits(bits, secondBits) {
  return decodeNearest(bits, secondBits ?? null, VERSION_TABLE, 3);
}

// src/core/format.ts
var EC_LEVELS = ["M", "L", "H", "Q"];
function readFormatInformation(matrix) {
  const size = matrix.size;
  const bit = (x, y) => matrix.get(x, y) ? 1 : 0;
  let bits1 = 0;
  for (let x = 0; x <= 5; x++) bits1 = bits1 << 1 | bit(x, 8);
  bits1 = bits1 << 1 | bit(7, 8);
  bits1 = bits1 << 1 | bit(8, 8);
  bits1 = bits1 << 1 | bit(8, 7);
  for (let y = 5; y >= 0; y--) bits1 = bits1 << 1 | bit(8, y);
  let bits2 = 0;
  for (let y = size - 1; y >= size - 7; y--) bits2 = bits2 << 1 | bit(8, y);
  for (let x = size - 8; x < size; x++) bits2 = bits2 << 1 | bit(x, 8);
  const data = decodeFormatBits(bits1, bits2);
  if (data === null) {
    throw new DecodeError("format-info", "format information is unreadable");
  }
  return {
    errorCorrectionLevel: EC_LEVELS[data >> 3 & 3],
    mask: data & 7
  };
}
function readVersionInformation(matrix) {
  const size = matrix.size;
  const bit = (x, y) => matrix.get(x, y) ? 1 : 0;
  let bits1 = 0;
  for (let x = 5; x >= 0; x--) {
    for (let y = size - 9; y >= size - 11; y--) bits1 = bits1 << 1 | bit(x, y);
  }
  let bits2 = 0;
  for (let y = 5; y >= 0; y--) {
    for (let x = size - 9; x >= size - 11; x--) bits2 = bits2 << 1 | bit(x, y);
  }
  return decodeVersionBits(bits1, bits2);
}

// src/core/bitstream.ts
var BitReader = class {
  constructor(bytes) {
    this.bytes = bytes;
    this.byteOffset = 0;
    this.bitOffset = 0;
  }
  available() {
    return 8 * (this.bytes.length - this.byteOffset) - this.bitOffset;
  }
  read(numBits) {
    if (numBits < 1 || numBits > 32) {
      throw new RangeError(`cannot read ${numBits} bits at once`);
    }
    if (numBits > this.available()) {
      throw new DecodeError(
        "bitstream",
        `bitstream exhausted: needed ${numBits} bits, ${this.available()} available`
      );
    }
    let result = 0;
    let remaining = numBits;
    while (remaining > 0) {
      const bitsLeftInByte = 8 - this.bitOffset;
      const toRead = Math.min(remaining, bitsLeftInByte);
      const shift = bitsLeftInByte - toRead;
      const mask = (1 << toRead) - 1 << shift;
      result = result << toRead | (this.bytes[this.byteOffset] & mask) >> shift;
      remaining -= toRead;
      this.bitOffset += toRead;
      if (this.bitOffset === 8) {
        this.bitOffset = 0;
        this.byteOffset++;
      }
    }
    return result;
  }
};

// src/core/segments.ts
var MODE_TERMINATOR = 0;
var MODE_NUMERIC = 1;
var MODE_ALPHANUMERIC = 2;
var MODE_STRUCTURED_APPEND = 3;
var MODE_BYTE = 4;
var MODE_FNC1_FIRST = 5;
var MODE_ECI = 7;
var MODE_KANJI = 8;
var MODE_FNC1_SECOND = 9;
var ALPHANUMERIC_CHARS = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ $%*+-./:";
function countBits(mode, version) {
  const index = version <= 9 ? 0 : version <= 26 ? 1 : 2;
  switch (mode) {
    case MODE_NUMERIC:
      return [10, 12, 14][index];
    case MODE_ALPHANUMERIC:
      return [9, 11, 13][index];
    case MODE_BYTE:
      return [8, 16, 16][index];
    case MODE_KANJI:
      return [8, 10, 12][index];
    default:
      throw new DecodeError("bitstream", `no count field for mode ${mode}`);
  }
}
function eciLabel(assignment) {
  if (assignment >= 4 && assignment <= 18 && assignment !== 14) {
    return `iso-8859-${assignment - 2}`;
  }
  switch (assignment) {
    case 1:
    case 3:
      return "iso-8859-1";
    case 20:
      return "shift_jis";
    case 21:
      return "windows-1250";
    case 22:
      return "windows-1251";
    case 23:
      return "windows-1252";
    case 24:
      return "windows-1256";
    case 25:
      return "utf-16be";
    case 26:
      return "utf-8";
    case 27:
    case 170:
      return "ascii";
    case 28:
      return "big5";
    case 29:
      return "gb18030";
    case 30:
      return "euc-kr";
    default:
      return null;
  }
}
function decodeBytes(bytes, eci) {
  if (eci !== null) {
    const label = eciLabel(eci);
    if (label !== null) {
      try {
        return new TextDecoder(label).decode(bytes);
      } catch {
      }
    }
  }
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder("iso-8859-1").decode(bytes);
  }
}
function decodeNumeric(reader, count) {
  let result = "";
  let remaining = count;
  while (remaining >= 3) {
    const value = reader.read(10);
    if (value >= 1e3) throw new DecodeError("bitstream", "invalid numeric triple");
    result += value.toString().padStart(3, "0");
    remaining -= 3;
  }
  if (remaining === 2) {
    const value = reader.read(7);
    if (value >= 100) throw new DecodeError("bitstream", "invalid numeric pair");
    result += value.toString().padStart(2, "0");
  } else if (remaining === 1) {
    const value = reader.read(4);
    if (value >= 10) throw new DecodeError("bitstream", "invalid numeric digit");
    result += value.toString();
  }
  return result;
}
function decodeKanjiBytes(reader, count) {
  const bytes = new Uint8Array(count * 2);
  for (let i = 0; i < count; i++) {
    const value = reader.read(13);
    const assembled = Math.floor(value / 192) << 8 | value % 192;
    const shiftJis = assembled + (assembled + 33088 <= 40956 ? 33088 : 49472);
    bytes[i * 2] = shiftJis >> 8;
    bytes[i * 2 + 1] = shiftJis & 255;
  }
  return bytes;
}
function decodeShiftJis(bytes) {
  try {
    return new TextDecoder("shift_jis").decode(bytes);
  } catch {
    throw new DecodeError("unsupported-mode", "no Shift-JIS decoder available in this runtime");
  }
}
function applyFnc1Escapes(text) {
  return text.replace(/%%|%/g, (match) => match === "%%" ? "%" : "");
}
function decodeAlphanumeric(reader, count) {
  let result = "";
  let remaining = count;
  while (remaining >= 2) {
    const value = reader.read(11);
    if (value >= 45 * 45) throw new DecodeError("bitstream", "invalid alphanumeric pair");
    result += ALPHANUMERIC_CHARS[Math.floor(value / 45)] + ALPHANUMERIC_CHARS[value % 45];
    remaining -= 2;
  }
  if (remaining === 1) {
    const value = reader.read(6);
    if (value >= 45) throw new DecodeError("bitstream", "invalid alphanumeric character");
    result += ALPHANUMERIC_CHARS[value];
  }
  return result;
}
function readEciAssignment(reader) {
  const first = reader.read(8);
  if ((first & 128) === 0) return first & 127;
  if ((first & 192) === 128) {
    return (first & 63) << 8 | reader.read(8);
  }
  if ((first & 224) === 192) {
    return (first & 31) << 16 | reader.read(16);
  }
  throw new DecodeError("bitstream", "invalid ECI designator");
}
var textEncoder = new TextEncoder();
function decodeSegments(data, version) {
  const reader = new BitReader(data);
  const segments = [];
  const byteChunks = [];
  let text = "";
  let eci = null;
  let structuredAppend;
  let fnc1;
  while (reader.available() >= 4) {
    const mode = reader.read(4);
    if (mode === MODE_TERMINATOR) break;
    switch (mode) {
      case MODE_NUMERIC: {
        const count = reader.read(countBits(mode, version));
        const decoded = decodeNumeric(reader, count);
        segments.push({ mode: "numeric", text: decoded });
        text += decoded;
        byteChunks.push(textEncoder.encode(decoded));
        break;
      }
      case MODE_ALPHANUMERIC: {
        const count = reader.read(countBits(mode, version));
        let decoded = decodeAlphanumeric(reader, count);
        if (fnc1 !== void 0) decoded = applyFnc1Escapes(decoded);
        segments.push({ mode: "alphanumeric", text: decoded });
        text += decoded;
        byteChunks.push(textEncoder.encode(decoded));
        break;
      }
      case MODE_BYTE: {
        const count = reader.read(countBits(mode, version));
        if (reader.available() < 8 * count) {
          throw new DecodeError("bitstream", "byte segment overruns data");
        }
        const bytes2 = new Uint8Array(count);
        for (let i = 0; i < count; i++) bytes2[i] = reader.read(8);
        const decoded = decodeBytes(bytes2, eci);
        segments.push({ mode: "byte", bytes: bytes2, text: decoded });
        text += decoded;
        byteChunks.push(bytes2);
        break;
      }
      case MODE_ECI: {
        eci = readEciAssignment(reader);
        segments.push({ mode: "eci", assignment: eci });
        break;
      }
      case MODE_STRUCTURED_APPEND: {
        structuredAppend = {
          index: reader.read(4),
          total: reader.read(4) + 1,
          parity: reader.read(8)
        };
        break;
      }
      case MODE_FNC1_FIRST: {
        fnc1 = { position: "first" };
        break;
      }
      case MODE_FNC1_SECOND: {
        const indicator = reader.read(8);
        fnc1 = {
          position: "second",
          applicationIndicator: indicator >= 100 && indicator <= 226 ? String.fromCharCode(indicator - 100) : String(indicator).padStart(2, "0")
        };
        break;
      }
      case MODE_KANJI: {
        const count = reader.read(countBits(mode, version));
        if (reader.available() < 13 * count) {
          throw new DecodeError("bitstream", "kanji segment overruns data");
        }
        const bytes2 = decodeKanjiBytes(reader, count);
        const decoded = decodeShiftJis(bytes2);
        segments.push({ mode: "kanji", bytes: bytes2, text: decoded });
        text += decoded;
        byteChunks.push(bytes2);
        break;
      }
      default:
        throw new DecodeError("bitstream", `unknown mode indicator ${mode}`);
    }
  }
  const totalBytes = byteChunks.reduce((sum, c) => sum + c.length, 0);
  const bytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of byteChunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  const result = { text, bytes, segments };
  if (structuredAppend !== void 0) result.structuredAppend = structuredAppend;
  if (fnc1 !== void 0) result.fnc1 = fnc1;
  return result;
}

// src/core/decode-matrix.ts
function decodeMatrix(matrix) {
  const version = versionForSize(matrix.size);
  if (version === null) {
    throw new DecodeError("invalid-dimension", `invalid QR matrix size ${matrix.size}`);
  }
  const { errorCorrectionLevel, mask } = readFormatInformation(matrix);
  const rawCodewords = readCodewords(matrix, version, mask);
  const {
    bytes: data,
    blocks,
    codewordsCorrected
  } = correctAndExtractData(rawCodewords, version, errorCorrectionLevel);
  const stream = decodeSegments(data, version);
  const result = {
    text: stream.text,
    bytes: stream.bytes,
    version,
    errorCorrectionLevel,
    mask,
    segments: stream.segments,
    ecc: { blocks, codewordsCorrected }
  };
  if (stream.structuredAppend !== void 0) result.structuredAppend = stream.structuredAppend;
  if (stream.fnc1 !== void 0) result.fnc1 = stream.fnc1;
  return result;
}

// src/detect/bit-image.ts
var BitImage = class _BitImage {
  constructor(width, height, bits) {
    this.width = width;
    this.height = height;
    this.bits = bits ?? new Uint8Array(width * height);
  }
  get(x, y) {
    return this.bits[y * this.width + x] !== 0;
  }
  set(x, y, value) {
    this.bits[y * this.width + x] = value ? 1 : 0;
  }
  inverted() {
    const bits = new Uint8Array(this.bits.length);
    for (let i = 0; i < bits.length; i++) bits[i] = this.bits[i] ? 0 : 1;
    return new _BitImage(this.width, this.height, bits);
  }
};

// src/detect/binarizer.ts
var FLAT_SPAN = 16;
var TINY_SIDE = 48;
var WINDOW_DIVISOR = 10;
var WINDOW_HALF_MIN = 8;
var WINDOW_HALF_MAX = 40;
function binarize(gray) {
  const { luma, width, height } = gray;
  const out = new BitImage(width, height);
  const tinyFrame = Math.min(width, height) < TINY_SIDE;
  const histogramStep = tinyFrame ? 1 : 2;
  const histogram = new Uint32Array(256);
  let sampled = 0;
  for (let y = 0; y < height; y += histogramStep) {
    const row = y * width;
    for (let x = 0; x < width; x += histogramStep) {
      histogram[luma[row + x]]++;
      sampled++;
    }
  }
  let darkest = 0;
  while (darkest < 255 && histogram[darkest] === 0) darkest++;
  let brightest = 255;
  while (brightest > 0 && histogram[brightest] === 0) brightest--;
  if (brightest - darkest < FLAT_SPAN) return out;
  const global = otsuThreshold(histogram, sampled);
  if (tinyFrame) {
    for (let i = 0; i < luma.length; i++) {
      if (luma[i] < global) out.bits[i] = 1;
    }
    return out;
  }
  const gridWidth = width >> 1;
  const gridHeight = height >> 1;
  const stride = gridWidth + 1;
  const sat = width * height < 16e6 ? new Uint32Array(stride * (gridHeight + 1)) : new Float64Array(stride * (gridHeight + 1));
  for (let gy = 0; gy < gridHeight; gy++) {
    const rowA = 2 * gy * width;
    const rowB = rowA + width;
    const satRow = (gy + 1) * stride;
    const satAbove = gy * stride;
    let rowSum = 0;
    for (let gx = 0; gx < gridWidth; gx++) {
      const x = 2 * gx;
      rowSum += luma[rowA + x] + luma[rowA + x + 1] + luma[rowB + x] + luma[rowB + x + 1];
      sat[satRow + gx + 1] = sat[satAbove + gx + 1] + rowSum;
    }
  }
  const half = Math.min(
    WINDOW_HALF_MAX,
    Math.max(WINDOW_HALF_MIN, Math.round(Math.min(width, height) / WINDOW_DIVISOR))
  );
  const deepDark = global >> 1;
  const bits = out.bits;
  const gridHalf = Math.max(2, half >> 1);
  const tile = Math.max(2, half >> 3);
  for (let tileY = 0; tileY < height; tileY += tile) {
    const tileBottom = Math.min(tileY + tile, height);
    const gridCenterY = tileY + (tile >> 1) >> 1;
    const top = Math.max(0, gridCenterY - gridHalf);
    const bottom = Math.min(gridHeight, gridCenterY + gridHalf + 1);
    const satTop = top * stride;
    const satBottom = bottom * stride;
    const rowSpan = bottom - top;
    for (let tileX = 0; tileX < width; tileX += tile) {
      const tileRight = Math.min(tileX + tile, width);
      const gridCenterX = tileX + (tile >> 1) >> 1;
      const left = Math.max(0, gridCenterX - gridHalf);
      const right = Math.min(gridWidth, gridCenterX + gridHalf + 1);
      const windowSum = sat[satBottom + right] - sat[satTop + right] - sat[satBottom + left] + sat[satTop + left];
      const mean = windowSum / (4 * (right - left) * rowSpan);
      const cut = Math.max(mean * 7 / 8, deepDark);
      for (let y = tileY; y < tileBottom; y++) {
        const row = y * width;
        for (let x = tileX; x < tileRight; x++) {
          if (luma[row + x] < cut) bits[row + x] = 1;
        }
      }
    }
  }
  return out;
}
function otsuThreshold(histogram, total) {
  let sumAll = 0;
  for (let v = 0; v < 256; v++) sumAll += v * histogram[v];
  let plateauStart = 127;
  let plateauEnd = 127;
  let bestSpread = -1;
  let countBelow = 0;
  let sumBelow = 0;
  for (let t = 0; t < 256; t++) {
    countBelow += histogram[t];
    if (countBelow === 0) continue;
    const countAbove = total - countBelow;
    if (countAbove === 0) break;
    sumBelow += t * histogram[t];
    const gap = sumBelow / countBelow - (sumAll - sumBelow) / countAbove;
    const spread = countBelow * countAbove * gap * gap;
    if (spread > bestSpread) {
      bestSpread = spread;
      plateauStart = t;
      plateauEnd = t;
    } else if (spread === bestSpread) {
      plateauEnd = t;
    }
  }
  return (plateauStart + plateauEnd >> 1) + 1;
}

// src/detect/alignment.ts
var CORE_CUTOFF = 0.45;
function findAlignmentPattern(image, expected, moduleSize, radiusModules) {
  const radius = Math.max(2, Math.round(radiusModules * moduleSize));
  const left = Math.max(0, Math.round(expected.x - radius));
  const right = Math.min(image.width - 1, Math.round(expected.x + radius));
  const top = Math.max(0, Math.round(expected.y - radius));
  const bottom = Math.min(image.height - 1, Math.round(expected.y + radius));
  if (right - left < 2 || bottom - top < 2) return null;
  let best = null;
  let bestOffset = Number.POSITIVE_INFINITY;
  for (let y = top; y <= bottom; y++) {
    let x = left;
    while (x <= right) {
      if (!image.get(x, y)) {
        x++;
        continue;
      }
      const darkStart = x;
      while (x <= right + 1 && x < image.width && image.get(x, y)) x++;
      const darkEnd = x;
      const center = coreMatches(image, darkStart, darkEnd, y, moduleSize);
      if (center === null) continue;
      const refined = confirmColumn(image, Math.floor(center), y, moduleSize);
      if (refined === null) continue;
      const offset = Math.hypot(center - expected.x, refined - expected.y);
      if (offset < bestOffset) {
        bestOffset = offset;
        best = { x: center, y: refined };
      }
    }
  }
  return best;
}
function coreMatches(image, darkStart, darkEnd, y, moduleSize) {
  const dark = darkEnd - darkStart;
  let lightLeft = 0;
  for (let x = darkStart - 1; x >= 0 && !image.get(x, y); x--) lightLeft++;
  let lightRight = 0;
  for (let x = darkEnd; x < image.width && !image.get(x, y); x++) lightRight++;
  if (lightLeft === 0 || lightRight === 0) return null;
  const clampedLeft = Math.min(lightLeft, moduleSize * 2);
  const clampedRight = Math.min(lightRight, moduleSize * 2);
  const score = (Math.abs(dark - moduleSize) + Math.abs(clampedLeft - moduleSize) + Math.abs(clampedRight - moduleSize)) / (3 * moduleSize);
  return score <= CORE_CUTOFF ? (darkStart + darkEnd) / 2 : null;
}
function confirmColumn(image, x, y, moduleSize) {
  if (!image.get(x, y)) return null;
  const height = image.height;
  let top = y;
  while (top >= 0 && image.get(x, top)) top--;
  let bottom = y + 1;
  while (bottom < height && image.get(x, bottom)) bottom++;
  const dark = bottom - top - 1;
  let lightAbove = 0;
  for (let yy = top; yy >= 0 && !image.get(x, yy); yy--) lightAbove++;
  let lightBelow = 0;
  for (let yy = bottom; yy < height && !image.get(x, yy); yy++) lightBelow++;
  if (lightAbove === 0 || lightBelow === 0) return null;
  const clampedAbove = Math.min(lightAbove, moduleSize * 2);
  const clampedBelow = Math.min(lightBelow, moduleSize * 2);
  const score = (Math.abs(dark - moduleSize) + Math.abs(clampedAbove - moduleSize) + Math.abs(clampedBelow - moduleSize)) / (3 * moduleSize);
  return score <= CORE_CUTOFF ? (top + 1 + bottom) / 2 : null;
}

// src/detect/finder.ts
var PROFILE_CUTOFF = 0.25;
var AXIS_AGREEMENT = 1.6;
var MIN_SIGHTINGS = 2;
var RANKING_POOL = 12;
function findFinderPatterns(image) {
  const clusters = [];
  const boundaries = [];
  for (let y = 0; y < image.height; y++) {
    scanRow(image, y, boundaries, clusters);
  }
  const patterns = [];
  for (const cluster of clusters) {
    if (cluster.count < MIN_SIGHTINGS) continue;
    patterns.push({
      x: cluster.sumX / cluster.count,
      y: cluster.sumY / cluster.count,
      moduleSize: cluster.sumModule / cluster.count,
      count: cluster.count
    });
  }
  return patterns;
}
function rankTriples(patterns) {
  if (patterns.length < 3) return [];
  const pool = [...patterns].sort((a, b) => b.count * b.moduleSize - a.count * a.moduleSize).slice(0, RANKING_POOL);
  const scored = [];
  for (let i = 0; i < pool.length; i++) {
    for (let j = i + 1; j < pool.length; j++) {
      for (let k = j + 1; k < pool.length; k++) {
        const ordered = orderAsCorners(pool[i], pool[j], pool[k]);
        const score = tripleScore(ordered);
        if (score !== null) scored.push({ score, ordered });
      }
    }
  }
  scored.sort((a, b) => a.score - b.score);
  return scored.map((entry) => entry.ordered);
}
function scanRow(image, y, boundaries, clusters) {
  const width = image.width;
  const rowBits = image.bits.subarray(y * width, (y + 1) * width);
  boundaries.length = 0;
  boundaries.push(0);
  let previous = rowBits[0];
  const rowStartsDark = previous !== 0;
  for (let x = 1; x < width; x++) {
    const bit = rowBits[x];
    if (bit !== previous) {
      boundaries.push(x);
      previous = bit;
    }
  }
  boundaries.push(width);
  const runCount = boundaries.length - 1;
  const firstDark = rowStartsDark ? 0 : 1;
  for (let run = firstDark; run + 5 <= runCount; run += 2) {
    const b0 = boundaries[run];
    const b1 = boundaries[run + 1];
    const b2 = boundaries[run + 2];
    const b3 = boundaries[run + 3];
    const b4 = boundaries[run + 4];
    const b5 = boundaries[run + 5];
    if (profileScore(b1 - b0, b2 - b1, b3 - b2, b4 - b3, b5 - b4) > PROFILE_CUTOFF) continue;
    const centerX = (b2 + b3) / 2;
    const horizontalSpan = b5 - b0;
    let confirmed = null;
    for (const jitter of [0, -1, 1, -2, 2]) {
      confirmed = confirmVertically(image, Math.floor(centerX) + jitter, y, horizontalSpan);
      if (confirmed !== null) break;
    }
    if (confirmed === null) continue;
    const moduleSize = (horizontalSpan + confirmed.span) / 14;
    recordSighting(clusters, centerX, confirmed.centerY, moduleSize);
  }
}
function profileScore(a, b, c, d, e) {
  const total = a + b + c + d + e;
  if (total < 7) return Number.POSITIVE_INFINITY;
  const unit = total / 7;
  const deviation = Math.abs(a - unit) + Math.abs(b - unit) + Math.abs(c - 3 * unit) + Math.abs(d - unit) + Math.abs(e - unit);
  return deviation / total;
}
function confirmVertically(image, x, y, horizontalSpan) {
  if (!image.get(x, y)) return null;
  const height = image.height;
  let top = y;
  while (top >= 0 && image.get(x, top)) top--;
  let lightTop = top;
  while (lightTop >= 0 && !image.get(x, lightTop)) lightTop--;
  let darkTop = lightTop;
  while (darkTop >= 0 && image.get(x, darkTop)) darkTop--;
  let bottom = y + 1;
  while (bottom < height && image.get(x, bottom)) bottom++;
  let lightBottom = bottom;
  while (lightBottom < height && !image.get(x, lightBottom)) lightBottom++;
  let darkBottom = lightBottom;
  while (darkBottom < height && image.get(x, darkBottom)) darkBottom++;
  const outerAbove = lightTop - darkTop;
  const lightAbove = top - lightTop;
  const center = bottom - top - 1;
  const lightBelow = lightBottom - bottom;
  const outerBelow = darkBottom - lightBottom;
  if (outerAbove === 0 || lightAbove === 0 || lightBelow === 0 || outerBelow === 0) return null;
  if (profileScore(outerAbove, lightAbove, center, lightBelow, outerBelow) > PROFILE_CUTOFF) {
    return null;
  }
  const span = outerAbove + lightAbove + center + lightBelow + outerBelow;
  const disagreement = Math.max(span, horizontalSpan) / Math.min(span, horizontalSpan);
  if (disagreement > AXIS_AGREEMENT) return null;
  return { centerY: (top + 1 + bottom) / 2, span };
}
function recordSighting(clusters, x, y, moduleSize) {
  for (const cluster of clusters) {
    const cx = cluster.sumX / cluster.count;
    const cy = cluster.sumY / cluster.count;
    const cm = cluster.sumModule / cluster.count;
    if (Math.abs(x - cx) <= cm && Math.abs(y - cy) <= cm && Math.abs(moduleSize - cm) <= cm * 0.5 + 0.5) {
      cluster.sumX += x;
      cluster.sumY += y;
      cluster.sumModule += moduleSize;
      cluster.count++;
      return;
    }
  }
  clusters.push({ sumX: x, sumY: y, sumModule: moduleSize, count: 1 });
}
function orderAsCorners(a, b, c) {
  const ab = squaredDistance(a, b);
  const bc = squaredDistance(b, c);
  const ac = squaredDistance(a, c);
  let corner;
  let first;
  let second;
  if (bc >= ab && bc >= ac) {
    corner = a;
    first = b;
    second = c;
  } else if (ac >= ab) {
    corner = b;
    first = a;
    second = c;
  } else {
    corner = c;
    first = a;
    second = b;
  }
  const cross = (first.x - corner.x) * (second.y - corner.y) - (first.y - corner.y) * (second.x - corner.x);
  return cross > 0 ? { topLeft: corner, topRight: first, bottomLeft: second } : { topLeft: corner, topRight: second, bottomLeft: first };
}
function tripleScore(ordered) {
  const { topLeft, topRight, bottomLeft } = ordered;
  const sizes = [topLeft.moduleSize, topRight.moduleSize, bottomLeft.moduleSize];
  const meanSize = (sizes[0] + sizes[1] + sizes[2]) / 3;
  const sizeSpread = (Math.max(...sizes) - Math.min(...sizes)) / meanSize;
  if (sizeSpread > 0.5) return null;
  const legTop = Math.hypot(topRight.x - topLeft.x, topRight.y - topLeft.y);
  const legSide = Math.hypot(bottomLeft.x - topLeft.x, bottomLeft.y - topLeft.y);
  const diagonal = Math.hypot(topRight.x - bottomLeft.x, topRight.y - bottomLeft.y);
  const legMean = (legTop + legSide) / 2;
  const spacingModules = legMean / meanSize;
  if (spacingModules < 9 || spacingModules > 185) return null;
  const legImbalance = Math.abs(legTop - legSide) / legMean;
  if (legImbalance > 0.6) return null;
  const diagonalError = Math.abs(diagonal - Math.SQRT2 * legMean) / diagonal;
  const cornerCos = ((topRight.x - topLeft.x) * (bottomLeft.x - topLeft.x) + (topRight.y - topLeft.y) * (bottomLeft.y - topLeft.y)) / (legTop * legSide);
  if (Math.abs(cornerCos) > 0.5) return null;
  return sizeSpread + legImbalance + 2 * diagonalError + Math.abs(cornerCos);
}
function squaredDistance(a, b) {
  return (a.x - b.x) ** 2 + (a.y - b.y) ** 2;
}

// src/detect/perspective.ts
function computeHomography(from, to) {
  const rows = [];
  for (let i = 0; i < 4; i++) {
    const { x, y } = from[i];
    const { x: u, y: v } = to[i];
    rows.push([x, y, 1, 0, 0, 0, -u * x, -u * y, u]);
    rows.push([0, 0, 0, x, y, 1, -v * x, -v * y, v]);
  }
  const solution = solveLinearSystem(rows);
  if (solution === null) return null;
  const h = new Float64Array(9);
  h.set(solution);
  h[8] = 1;
  return h;
}
function applyHomography(h, x, y) {
  const w = h[6] * x + h[7] * y + 1;
  return {
    x: (h[0] * x + h[1] * y + h[2]) / w,
    y: (h[3] * x + h[4] * y + h[5]) / w
  };
}
function solveLinearSystem(rows) {
  const n = rows.length;
  for (let col = 0; col < n; col++) {
    let pivotRow = col;
    for (let r = col + 1; r < n; r++) {
      if (Math.abs(rows[r][col]) > Math.abs(rows[pivotRow][col])) pivotRow = r;
    }
    const pivot = rows[pivotRow][col];
    if (Math.abs(pivot) < 1e-12) return null;
    if (pivotRow !== col) {
      const swap = rows[col];
      rows[col] = rows[pivotRow];
      rows[pivotRow] = swap;
    }
    const lead = rows[col];
    for (let r = col + 1; r < n; r++) {
      const row = rows[r];
      const factor = row[col] / pivot;
      if (factor === 0) continue;
      for (let c = col; c <= n; c++) {
        row[c] -= factor * lead[c];
      }
    }
  }
  const solution = new Array(n);
  for (let r = n - 1; r >= 0; r--) {
    const row = rows[r];
    let value = row[n];
    for (let c = r + 1; c < n; c++) {
      value -= row[c] * solution[c];
    }
    solution[r] = value / row[r];
  }
  return solution;
}

// src/detect/detector.ts
var FINDER_INSET = 3.5;
var ALIGNMENT_INSET = 6.5;
var DIMENSION_SLACK = 2.5;
var ALIGNMENT_RADIUS = 5;
var TIMING_AGREEMENT = 0.7;
function* iterateDetections(image, maxTriples) {
  const patterns = findFinderPatterns(image);
  const triples = rankTriples(patterns);
  const budget = Math.min(triples.length, maxTriples);
  for (let i = 0; i < budget; i++) {
    const detection = assembleDetection(image, triples[i]);
    if (detection !== null) yield detection;
  }
}
function assembleDetection(image, patterns) {
  const { topLeft, topRight, bottomLeft } = patterns;
  const moduleAcross = axisModuleSize(image, topLeft, topRight) ?? (topLeft.moduleSize + topRight.moduleSize) / 2;
  const moduleDown = axisModuleSize(image, topLeft, bottomLeft) ?? (topLeft.moduleSize + bottomLeft.moduleSize) / 2;
  const moduleSize = (moduleAcross + moduleDown) / 2;
  if (moduleSize < 1) return null;
  const acrossModules = Math.hypot(topRight.x - topLeft.x, topRight.y - topLeft.y) / moduleAcross;
  const downModules = Math.hypot(bottomLeft.x - topLeft.x, bottomLeft.y - topLeft.y) / moduleDown;
  const estimatedDimension = (acrossModules + downModules) / 2 + 7;
  for (const version of candidateVersions(estimatedDimension)) {
    const detection = buildAtVersion(image, patterns, moduleSize, version);
    if (detection !== null) return detection;
  }
  return null;
}
function candidateVersions(estimatedDimension) {
  const nearest = Math.round((estimatedDimension - 17) / 4);
  const versions = [];
  for (const version of [nearest, nearest - 1, nearest + 1]) {
    if (version < 1 || version > 40) continue;
    if (Math.abs(estimatedDimension - sizeForVersion(version)) > DIMENSION_SLACK) continue;
    versions.push(version);
  }
  return versions;
}
function axisModuleSize(image, from, to) {
  const forward = edgeProfileModule(image, from, to);
  const backward = edgeProfileModule(image, to, from);
  if (forward === null || backward === null) return forward ?? backward;
  return (forward + backward) / 2;
}
function edgeProfileModule(image, from, to) {
  const distance = Math.hypot(to.x - from.x, to.y - from.y);
  if (distance === 0) return null;
  const stepX = (to.x - from.x) / distance;
  const stepY = (to.y - from.y) / distance;
  const limit = Math.min(distance / 2, image.width + image.height);
  const flips = [];
  let previous = true;
  for (let t = 0.5; t < limit && flips.length < 3; t += 0.5) {
    const x = Math.floor(from.x + stepX * t);
    const y = Math.floor(from.y + stepY * t);
    if (x < 0 || x >= image.width || y < 0 || y >= image.height) break;
    const dark = image.get(x, y);
    if (dark !== previous) {
      flips.push(t - 0.25);
      previous = dark;
    }
  }
  if (flips.length < 3) return null;
  return (flips[0] / 1.5 + (flips[1] - flips[0]) + (flips[2] - flips[1])) / 3;
}
function buildAtVersion(image, patterns, moduleSize, version) {
  const { topLeft, topRight, bottomLeft } = patterns;
  const dimension = sizeForVersion(version);
  let sourceBottomRight = {
    x: dimension - FINDER_INSET,
    y: dimension - FINDER_INSET
  };
  let imageBottomRight = {
    x: topRight.x + bottomLeft.x - topLeft.x,
    y: topRight.y + bottomLeft.y - topLeft.y
  };
  if (version >= 2) {
    const fraction = (dimension - FINDER_INSET - ALIGNMENT_INSET) / (dimension - 7);
    const predicted = {
      x: topLeft.x + fraction * (topRight.x - topLeft.x + bottomLeft.x - topLeft.x),
      y: topLeft.y + fraction * (topRight.y - topLeft.y + bottomLeft.y - topLeft.y)
    };
    const found = findAlignmentPattern(image, predicted, moduleSize, ALIGNMENT_RADIUS);
    if (found !== null) {
      sourceBottomRight = { x: dimension - ALIGNMENT_INSET, y: dimension - ALIGNMENT_INSET };
      imageBottomRight = found;
    }
  }
  const moduleQuad = [
    { x: FINDER_INSET, y: FINDER_INSET },
    { x: dimension - FINDER_INSET, y: FINDER_INSET },
    sourceBottomRight,
    { x: FINDER_INSET, y: dimension - FINDER_INSET }
  ];
  const imageQuad = [
    { x: topLeft.x, y: topLeft.y },
    { x: topRight.x, y: topRight.y },
    imageBottomRight,
    { x: bottomLeft.x, y: bottomLeft.y }
  ];
  const homography = computeHomography(moduleQuad, imageQuad);
  if (homography === null) return null;
  if (!timingPatternsAgree(image, homography, dimension)) return null;
  const matrix = sampleModules(image, homography, dimension);
  if (matrix === null) return null;
  if (version >= 7) {
    const declared = readVersionInformation(matrix);
    if (declared !== null && declared !== version) return null;
  }
  const cornerPoints = [
    applyHomography(homography, 0, 0),
    applyHomography(homography, dimension, 0),
    applyHomography(homography, dimension, dimension),
    applyHomography(homography, 0, dimension)
  ];
  for (const corner of cornerPoints) {
    if (!Number.isFinite(corner.x) || !Number.isFinite(corner.y)) return null;
  }
  return { matrix, cornerPoints, moduleSize, patterns };
}
function timingPatternsAgree(image, h, dimension) {
  let agreements = 0;
  let total = 0;
  for (let module = 8; module <= dimension - 9; module++) {
    const expectDark = module % 2 === 0;
    if (sampleAt(image, h, module + 0.5, 6.5) === expectDark) agreements++;
    if (sampleAt(image, h, 6.5, module + 0.5) === expectDark) agreements++;
    total += 2;
  }
  return total === 0 || agreements >= total * TIMING_AGREEMENT;
}
function sampleAt(image, h, mx, my) {
  const point = applyHomography(h, mx, my);
  const x = Math.floor(point.x);
  const y = Math.floor(point.y);
  if (x < 0 || x >= image.width || y < 0 || y >= image.height) return false;
  return image.get(x, y);
}
function sampleModules(image, h, dimension) {
  const matrix = new BitMatrix(dimension);
  const width = image.width;
  const height = image.height;
  let escaped = 0;
  const escapeLimit = Math.ceil(dimension * dimension / 8);
  for (let my = 0; my < dimension; my++) {
    for (let mx = 0; mx < dimension; mx++) {
      const point = applyHomography(h, mx + 0.5, my + 0.5);
      let x = Math.floor(point.x);
      let y = Math.floor(point.y);
      if (x < 0 || x >= width || y < 0 || y >= height) {
        if (++escaped > escapeLimit) return null;
        x = Math.min(width - 1, Math.max(0, x));
        y = Math.min(height - 1, Math.max(0, y));
      }
      matrix.set(mx, my, image.get(x, y));
    }
  }
  return matrix;
}

// src/detect/downscale.ts
function downscaleGray(gray, factor) {
  const width = Math.floor(gray.width / factor);
  const height = Math.floor(gray.height / factor);
  const luma = new Uint8Array(width * height);
  const area = factor * factor;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let sum = 0;
      const srcY = y * factor;
      const srcX = x * factor;
      for (let dy = 0; dy < factor; dy++) {
        const rowOffset = (srcY + dy) * gray.width + srcX;
        for (let dx = 0; dx < factor; dx++) {
          sum += gray.luma[rowOffset + dx];
        }
      }
      luma[y * width + x] = sum / area;
    }
  }
  return { luma, width, height };
}

// src/detect/grayscale.ts
function toGrayscale(image) {
  const { data, width, height } = image;
  if (data.length < width * height * 4) {
    throw new RangeError("image data too short for RGBA dimensions");
  }
  const luma = new Uint8Array(width * height);
  for (let i = 0, p = 0; i < luma.length; i++, p += 4) {
    luma[i] = 77 * data[p] + 150 * data[p + 1] + 29 * data[p + 2] >> 8;
  }
  return { luma, width, height };
}

// src/decode.ts
var AUTO_DOWNSCALE_THRESHOLD = 1e3;
var MIN_DECODABLE_SIZE = 21;
var MULTI_TRIPLE_LIMIT = 16;
var DEFAULT_MAX_DETECTIONS = 8;
function decode(image, options = {}) {
  return scanImage(image, options, singleMode(options)).results[0] ?? null;
}
function decodeAll(image, options = {}) {
  const mode = {
    decode: true,
    multiple: true,
    maxTriples: MULTI_TRIPLE_LIMIT,
    maxDetections: DEFAULT_MAX_DETECTIONS
  };
  return scanImage(image, options, mode).results;
}
function detect(image, options = {}) {
  const mode = {
    decode: false,
    multiple: false,
    maxTriples: MULTI_TRIPLE_LIMIT,
    maxDetections: options.maxCandidates ?? 4
  };
  return scanImage(image, options, mode).detections;
}
function scanFrame(image, options = {}) {
  const mode = options.multiple === true ? {
    decode: true,
    multiple: true,
    maxTriples: MULTI_TRIPLE_LIMIT,
    maxDetections: DEFAULT_MAX_DETECTIONS
  } : singleMode(options);
  return scanImage(image, options, mode);
}
function singleMode(options) {
  return {
    decode: true,
    multiple: false,
    maxTriples: options.tryHarder === true ? 4 : 1,
    maxDetections: 4
  };
}
function scanImage(image, options, mode) {
  const gray = toGrayscale(image);
  const tryInverted = options.tryInverted !== false;
  const results = [];
  const detections = [];
  for (const factor of planScales(gray, options)) {
    const scaled = factor === 1 ? gray : downscaleGray(gray, factor);
    const bits = binarize(scaled);
    for (let polarity = 0; polarity < (tryInverted ? 2 : 1); polarity++) {
      scanPass(polarity === 0 ? bits : bits.inverted(), factor, mode, results, detections);
      if (mode.decode && !mode.multiple && results.length > 0) {
        finalize(results, options);
        return { results, detections };
      }
    }
  }
  finalize(results, options);
  return { results, detections };
}
function scanPass(bits, factor, mode, results, detections) {
  const consumed = /* @__PURE__ */ new Set();
  const listed = /* @__PURE__ */ new Set();
  for (const detection of iterateDetections(bits, mode.maxTriples)) {
    const { topLeft, topRight, bottomLeft } = detection.patterns;
    if (consumed.has(topLeft) || consumed.has(topRight) || consumed.has(bottomLeft)) continue;
    if (detections.length < mode.maxDetections && !(listed.has(topLeft) || listed.has(topRight) || listed.has(bottomLeft))) {
      const candidate = {
        cornerPoints: scaleCorners(detection.cornerPoints, factor),
        moduleSize: detection.moduleSize * factor
      };
      if (!detections.some((d) => sameLocation(d.cornerPoints, candidate.cornerPoints))) {
        detections.push(candidate);
      }
      listed.add(topLeft);
      listed.add(topRight);
      listed.add(bottomLeft);
    }
    if (!mode.decode) continue;
    let decoded;
    try {
      decoded = decodeMatrix(detection.matrix);
    } catch (error) {
      if (error instanceof DecodeError) continue;
      throw error;
    }
    const result = {
      ...decoded,
      cornerPoints: scaleCorners(detection.cornerPoints, factor),
      moduleSize: detection.moduleSize * factor
    };
    if (!results.some(
      (r) => r.text === result.text && sameLocation(r.cornerPoints, result.cornerPoints)
    )) {
      results.push(result);
    }
    consumed.add(topLeft);
    consumed.add(topRight);
    consumed.add(bottomLeft);
    if (!mode.multiple) return;
  }
}
function finalize(results, options) {
  if (options.parseContent === false) return;
  for (const result of results) {
    result.content = parseContent(result.text, { gs1: result.fnc1?.position === "first" });
  }
}
function scaleCorners(corners, factor) {
  return [
    { x: corners[0].x * factor, y: corners[0].y * factor },
    { x: corners[1].x * factor, y: corners[1].y * factor },
    { x: corners[2].x * factor, y: corners[2].y * factor },
    { x: corners[3].x * factor, y: corners[3].y * factor }
  ];
}
function sameLocation(a, b) {
  const size = Math.max(
    Math.hypot(a[2].x - a[0].x, a[2].y - a[0].y),
    Math.hypot(b[2].x - b[0].x, b[2].y - b[0].y)
  );
  const ax = (a[0].x + a[1].x + a[2].x + a[3].x) / 4;
  const ay = (a[0].y + a[1].y + a[2].y + a[3].y) / 4;
  const bx = (b[0].x + b[1].x + b[2].x + b[3].x) / 4;
  const by = (b[0].y + b[1].y + b[2].y + b[3].y) / 4;
  return Math.hypot(ax - bx, ay - by) < size / 2;
}
function planScales(gray, options) {
  const maxDownscale = Math.max(1, Math.floor(options.maxDownscale ?? 1));
  const longestSide = Math.max(gray.width, gray.height);
  const shortestSide = Math.min(gray.width, gray.height);
  const scales = [];
  let auto = 1;
  while (auto * 2 <= maxDownscale && longestSide / auto > AUTO_DOWNSCALE_THRESHOLD) {
    auto *= 2;
  }
  if (auto > 1) scales.push(auto);
  scales.push(1);
  if (options.tryHarder === true && !scales.includes(2) && shortestSide / 2 >= MIN_DECODABLE_SIZE) {
    scales.push(2);
  }
  return scales;
}

export { BitMatrix, DecodeError, decode, decodeAll, decodeMatrix, detect, parseContent, scanFrame };
//# sourceMappingURL=chunk-VQB7DEOH.js.map
//# sourceMappingURL=chunk-VQB7DEOH.js.map