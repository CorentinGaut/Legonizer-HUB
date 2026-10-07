/**
 * Baseline JPEG encoder (ITU-T T.81 / ISO/IEC 10918-1, JFIF 1.01), 8-bit, YCbCr 4:4:4, standard
 * quantization tables (Annex K.1) scaled by the IJG quality formula and standard Huffman tables
 * (Annex K.3). Used for the legacy projection layer `calqueTemplate.jpg` (SPEC O2): UD-Viz wrote it
 * with `canvas.toDataURL('image/jpeg')` (quality 0.92 in Chromium); an in-house encoder keeps the
 * file identical in every browser and testable in Node, and needs no OffscreenCanvas.
 */

const ZIGZAG = [
  0, 1, 8, 16, 9, 2, 3, 10, 17, 24, 32, 25, 18, 11, 4, 5, 12, 19, 26, 33, 40, 48, 41, 34, 27, 20, 13, 6, 7,
  14, 21, 28, 35, 42, 49, 56, 57, 50, 43, 36, 29, 22, 15, 23, 30, 37, 44, 51, 58, 59, 52, 45, 38, 31, 39, 46,
  53, 60, 61, 54, 47, 55, 62, 63,
];

const STD_LUMA_Q = [
  16, 11, 10, 16, 24, 40, 51, 61, 12, 12, 14, 19, 26, 58, 60, 55, 14, 13, 16, 24, 40, 57, 69, 56, 14, 17, 22,
  29, 51, 87, 80, 62, 18, 22, 37, 56, 68, 109, 103, 77, 24, 35, 55, 64, 81, 104, 113, 92, 49, 64, 78, 87, 103,
  121, 120, 101, 72, 92, 95, 98, 112, 100, 103, 99,
];
const STD_CHROMA_Q = [
  17,
  18,
  24,
  47,
  99,
  99,
  99,
  99,
  18,
  21,
  26,
  66,
  99,
  99,
  99,
  99,
  24,
  26,
  56,
  99,
  99,
  99,
  99,
  99,
  47,
  66,
  99,
  99,
  99,
  99,
  99,
  99,
  ...new Array<number>(32).fill(99),
];

const DC_LUMA_BITS = [0, 1, 5, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0];
const DC_LUMA_VALS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];
const DC_CHROMA_BITS = [0, 3, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0];
const DC_CHROMA_VALS = DC_LUMA_VALS;
const AC_LUMA_BITS = [0, 2, 1, 3, 3, 2, 4, 3, 5, 5, 4, 4, 0, 0, 1, 0x7d];
const AC_LUMA_VALS = [
  0x01, 0x02, 0x03, 0x00, 0x04, 0x11, 0x05, 0x12, 0x21, 0x31, 0x41, 0x06, 0x13, 0x51, 0x61, 0x07, 0x22, 0x71,
  0x14, 0x32, 0x81, 0x91, 0xa1, 0x08, 0x23, 0x42, 0xb1, 0xc1, 0x15, 0x52, 0xd1, 0xf0, 0x24, 0x33, 0x62, 0x72,
  0x82, 0x09, 0x0a, 0x16, 0x17, 0x18, 0x19, 0x1a, 0x25, 0x26, 0x27, 0x28, 0x29, 0x2a, 0x34, 0x35, 0x36, 0x37,
  0x38, 0x39, 0x3a, 0x43, 0x44, 0x45, 0x46, 0x47, 0x48, 0x49, 0x4a, 0x53, 0x54, 0x55, 0x56, 0x57, 0x58, 0x59,
  0x5a, 0x63, 0x64, 0x65, 0x66, 0x67, 0x68, 0x69, 0x6a, 0x73, 0x74, 0x75, 0x76, 0x77, 0x78, 0x79, 0x7a, 0x83,
  0x84, 0x85, 0x86, 0x87, 0x88, 0x89, 0x8a, 0x92, 0x93, 0x94, 0x95, 0x96, 0x97, 0x98, 0x99, 0x9a, 0xa2, 0xa3,
  0xa4, 0xa5, 0xa6, 0xa7, 0xa8, 0xa9, 0xaa, 0xb2, 0xb3, 0xb4, 0xb5, 0xb6, 0xb7, 0xb8, 0xb9, 0xba, 0xc2, 0xc3,
  0xc4, 0xc5, 0xc6, 0xc7, 0xc8, 0xc9, 0xca, 0xd2, 0xd3, 0xd4, 0xd5, 0xd6, 0xd7, 0xd8, 0xd9, 0xda, 0xe1, 0xe2,
  0xe3, 0xe4, 0xe5, 0xe6, 0xe7, 0xe8, 0xe9, 0xea, 0xf1, 0xf2, 0xf3, 0xf4, 0xf5, 0xf6, 0xf7, 0xf8, 0xf9, 0xfa,
];
const AC_CHROMA_BITS = [0, 2, 1, 2, 4, 4, 3, 4, 7, 5, 4, 4, 0, 1, 2, 0x77];
const AC_CHROMA_VALS = [
  0x00, 0x01, 0x02, 0x03, 0x11, 0x04, 0x05, 0x21, 0x31, 0x06, 0x12, 0x41, 0x51, 0x07, 0x61, 0x71, 0x13, 0x22,
  0x32, 0x81, 0x08, 0x14, 0x42, 0x91, 0xa1, 0xb1, 0xc1, 0x09, 0x23, 0x33, 0x52, 0xf0, 0x15, 0x62, 0x72, 0xd1,
  0x0a, 0x16, 0x24, 0x34, 0xe1, 0x25, 0xf1, 0x17, 0x18, 0x19, 0x1a, 0x26, 0x27, 0x28, 0x29, 0x2a, 0x35, 0x36,
  0x37, 0x38, 0x39, 0x3a, 0x43, 0x44, 0x45, 0x46, 0x47, 0x48, 0x49, 0x4a, 0x53, 0x54, 0x55, 0x56, 0x57, 0x58,
  0x59, 0x5a, 0x63, 0x64, 0x65, 0x66, 0x67, 0x68, 0x69, 0x6a, 0x73, 0x74, 0x75, 0x76, 0x77, 0x78, 0x79, 0x7a,
  0x82, 0x83, 0x84, 0x85, 0x86, 0x87, 0x88, 0x89, 0x8a, 0x92, 0x93, 0x94, 0x95, 0x96, 0x97, 0x98, 0x99, 0x9a,
  0xa2, 0xa3, 0xa4, 0xa5, 0xa6, 0xa7, 0xa8, 0xa9, 0xaa, 0xb2, 0xb3, 0xb4, 0xb5, 0xb6, 0xb7, 0xb8, 0xb9, 0xba,
  0xc2, 0xc3, 0xc4, 0xc5, 0xc6, 0xc7, 0xc8, 0xc9, 0xca, 0xd2, 0xd3, 0xd4, 0xd5, 0xd6, 0xd7, 0xd8, 0xd9, 0xda,
  0xe2, 0xe3, 0xe4, 0xe5, 0xe6, 0xe7, 0xe8, 0xe9, 0xea, 0xf2, 0xf3, 0xf4, 0xf5, 0xf6, 0xf7, 0xf8, 0xf9, 0xfa,
];

interface HuffTable {
  code: Uint16Array;
  size: Uint8Array;
}

/** Canonical Huffman codes from the BITS/HUFFVAL lists (T.81 Annex C). */
function buildHuffman(bits: number[], vals: number[]): HuffTable {
  const code = new Uint16Array(256);
  const size = new Uint8Array(256);
  let c = 0,
    k = 0;
  for (let len = 1; len <= 16; len++) {
    for (let i = 0; i < bits[len - 1]!; i++) {
      code[vals[k]!] = c;
      size[vals[k]!] = len;
      c++;
      k++;
    }
    c <<= 1;
  }
  return { code, size };
}

/** IJG quality scaling (jcparam.c): 50 = the standard tables. */
export function scaledQuantTable(base: number[], quality: number): Uint8Array {
  const q = Math.min(100, Math.max(1, Math.round(quality)));
  const scale = q < 50 ? Math.floor(5000 / q) : 200 - 2 * q;
  return Uint8Array.from(base, (v) => Math.min(255, Math.max(1, Math.floor((v * scale + 50) / 100))));
}

const COS = (() => {
  const t = new Float64Array(64);
  for (let u = 0; u < 8; u++)
    for (let x = 0; x < 8; x++)
      t[u * 8 + x] = ((u === 0 ? Math.SQRT1_2 : 1) / 2) * Math.cos(((2 * x + 1) * u * Math.PI) / 16);
  return t;
})();

class BitWriter {
  private buf: Uint8Array;
  length = 0;
  private acc = 0;
  private n = 0;
  constructor(capacity = 1 << 16) {
    this.buf = new Uint8Array(capacity);
  }
  private grow(extra: number) {
    if (this.length + extra <= this.buf.length) return;
    const next = new Uint8Array(Math.max(this.buf.length * 2, this.length + extra));
    next.set(this.buf.subarray(0, this.length));
    this.buf = next;
  }
  byte(b: number) {
    this.grow(1);
    this.buf[this.length++] = b;
  }
  bytes(a: ArrayLike<number>) {
    this.grow(a.length);
    for (let i = 0; i < a.length; i++) this.buf[this.length++] = a[i]!;
  }
  u16(v: number) {
    this.byte((v >> 8) & 0xff);
    this.byte(v & 0xff);
  }
  bits(value: number, count: number) {
    for (let i = count - 1; i >= 0; i--) {
      this.acc = (this.acc << 1) | ((value >> i) & 1);
      if (++this.n === 8) {
        this.byte(this.acc);
        if (this.acc === 0xff) this.byte(0); // byte stuffing
        this.acc = 0;
        this.n = 0;
      }
    }
  }
  flushBits() {
    if (this.n > 0) this.bits((1 << (8 - this.n)) - 1, 8 - this.n); // pad with 1-bits (F.1.2.3)
  }
  result(): Uint8Array {
    return this.buf.slice(0, this.length);
  }
}

function category(v: number): number {
  let a = Math.abs(v),
    n = 0;
  while (a) {
    n++;
    a >>= 1;
  }
  return n;
}

export interface JpegOptions {
  /** 1–100, IJG scale (default 92, the Chromium default of `toDataURL('image/jpeg')`). */
  quality?: number;
  /** Pixel density written in the JFIF header (dots per inch); default: aspect ratio only. */
  dpi?: number;
}

/** Encodes an RGBA raster (alpha ignored, assumed opaque) as a baseline JFIF file. */
export function encodeJpeg(
  rgba: Uint8ClampedArray | Uint8Array,
  width: number,
  height: number,
  opts: JpegOptions = {},
): Uint8Array {
  const quality = opts.quality ?? 92;
  const qY = scaledQuantTable(STD_LUMA_Q, quality);
  const qC = scaledQuantTable(STD_CHROMA_Q, quality);
  const dcY = buildHuffman(DC_LUMA_BITS, DC_LUMA_VALS);
  const acY = buildHuffman(AC_LUMA_BITS, AC_LUMA_VALS);
  const dcC = buildHuffman(DC_CHROMA_BITS, DC_CHROMA_VALS);
  const acC = buildHuffman(AC_CHROMA_BITS, AC_CHROMA_VALS);

  const w = new BitWriter(Math.max(1 << 16, (width * height) >> 3));
  // SOI + APP0 (JFIF 1.01)
  w.bytes([0xff, 0xd8, 0xff, 0xe0]);
  w.u16(16);
  w.bytes([0x4a, 0x46, 0x49, 0x46, 0, 1, 1]);
  if (opts.dpi) {
    w.byte(1);
    w.u16(Math.round(opts.dpi));
    w.u16(Math.round(opts.dpi));
  } else {
    w.byte(0);
    w.u16(1);
    w.u16(1);
  }
  w.bytes([0, 0]);
  // DQT (zigzag order)
  for (const [id, t] of [
    [0, qY],
    [1, qC],
  ] as const) {
    w.bytes([0xff, 0xdb]);
    w.u16(67);
    w.byte(id);
    for (let i = 0; i < 64; i++) w.byte(t[ZIGZAG[i]!]!);
  }
  // SOF0: 3 components, no subsampling
  w.bytes([0xff, 0xc0]);
  w.u16(17);
  w.byte(8);
  w.u16(height);
  w.u16(width);
  w.bytes([3, 1, 0x11, 0, 2, 0x11, 1, 3, 0x11, 1]);
  // DHT
  const dht = (cls: number, id: number, bits: number[], vals: number[]) => {
    w.bytes([0xff, 0xc4]);
    w.u16(3 + 16 + vals.length);
    w.byte((cls << 4) | id);
    w.bytes(bits);
    w.bytes(vals);
  };
  dht(0, 0, DC_LUMA_BITS, DC_LUMA_VALS);
  dht(1, 0, AC_LUMA_BITS, AC_LUMA_VALS);
  dht(0, 1, DC_CHROMA_BITS, DC_CHROMA_VALS);
  dht(1, 1, AC_CHROMA_BITS, AC_CHROMA_VALS);
  // SOS
  w.bytes([0xff, 0xda]);
  w.u16(12);
  w.bytes([3, 1, 0x00, 2, 0x11, 3, 0x11, 0, 63, 0]);

  const Yb = new Float64Array(64),
    Cbb = new Float64Array(64),
    Crb = new Float64Array(64);
  const tmp = new Float64Array(64);
  const coef = new Int32Array(64);
  let prevY = 0,
    prevCb = 0,
    prevCr = 0;

  const encodeBlock = (block: Float64Array, q: Uint8Array, prevDc: number, dc: HuffTable, ac: HuffTable) => {
    // constant block (very common in a calque): only the DC term
    let constant = true;
    for (let i = 1; i < 64 && constant; i++) if (block[i] !== block[0]) constant = false;
    if (constant) {
      coef.fill(0);
      coef[0] = Math.round((block[0]! * 8) / q[0]!);
    } else {
      // separable DCT-II: rows then columns
      for (let y = 0; y < 8; y++)
        for (let u = 0; u < 8; u++) {
          let s = 0;
          for (let x = 0; x < 8; x++) s += COS[u * 8 + x]! * block[y * 8 + x]!;
          tmp[y * 8 + u] = s;
        }
      for (let v = 0; v < 8; v++)
        for (let u = 0; u < 8; u++) {
          let s = 0;
          for (let y = 0; y < 8; y++) s += COS[v * 8 + y]! * tmp[y * 8 + u]!;
          coef[v * 8 + u] = Math.round(s / q[v * 8 + u]!);
        }
    }
    const dcv = coef[0]!;
    const diff = dcv - prevDc;
    const cat = category(diff);
    w.bits(dc.code[cat]!, dc.size[cat]!);
    if (cat) w.bits(diff < 0 ? diff + (1 << cat) - 1 : diff, cat);
    let run = 0;
    for (let k = 1; k < 64; k++) {
      const v = coef[ZIGZAG[k]!]!;
      if (v === 0) {
        run++;
        continue;
      }
      while (run > 15) {
        w.bits(ac.code[0xf0]!, ac.size[0xf0]!);
        run -= 16;
      }
      const c = category(v);
      const sym = (run << 4) | c;
      w.bits(ac.code[sym]!, ac.size[sym]!);
      w.bits(v < 0 ? v + (1 << c) - 1 : v, c);
      run = 0;
    }
    if (run > 0) w.bits(ac.code[0]!, ac.size[0]!);
    return dcv;
  };

  for (let by = 0; by < height; by += 8) {
    for (let bx = 0; bx < width; bx += 8) {
      for (let y = 0; y < 8; y++) {
        const sy = Math.min(height - 1, by + y);
        for (let x = 0; x < 8; x++) {
          const sx = Math.min(width - 1, bx + x);
          const o = (sy * width + sx) * 4;
          const r = rgba[o]!,
            g = rgba[o + 1]!,
            b = rgba[o + 2]!;
          const k = y * 8 + x;
          Yb[k] = 0.299 * r + 0.587 * g + 0.114 * b - 128;
          Cbb[k] = -0.168736 * r - 0.331264 * g + 0.5 * b;
          Crb[k] = 0.5 * r - 0.418688 * g - 0.081312 * b;
        }
      }
      prevY = encodeBlock(Yb, qY, prevY, dcY, acY);
      prevCb = encodeBlock(Cbb, qC, prevCb, dcC, acC);
      prevCr = encodeBlock(Crb, qC, prevCr, dcC, acC);
    }
  }
  w.flushBits();
  w.bytes([0xff, 0xd9]);
  return w.result();
}
