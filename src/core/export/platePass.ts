/**
 * Plate pass payload (SPEC O10): one baseplate's heights, the part settings and the app/packing
 * versions, encoded for a URL fragment so a phone can open that plate's instructions with no
 * server. Layout before compression (format 1):
 *
 *   u8 format (=1) · u8 packing algorithm version · str app version · str plate name · str title
 *   u16 LE enabled-part mask (bit i = BRICKS[i], 1×1 always set; bits 14–15 = tile cap: 0 none,
 *   1 roofs, 2 all, so passes made before the cap decode as 'none') · u8 max length
 *   run-length heights: (varint value, varint run) pairs over the 32×32 cells, row j = 0 (south)
 *   to 31, column i = 0 (west) to 31
 *
 * (str = varint byte length + UTF-8). The bytes are raw-deflated (fflate, level 9) and written in
 * base64url without padding (RFC 4648 §5).
 *
 * QR byte-mode capacities (ISO/IEC 18004, as tabulated at https://www.thonky.com/qr-code-tutorial/character-capacities,
 * checked 2026-10-06) let the UI decide whether a pass is still scannable.
 */
import { deflateSync, inflateSync } from 'fflate';
import { STUDS_PER_PLATE } from '../types.ts';
import {
  BRICKS,
  TILE_CAP_MODES,
  normalizeInventory,
  type InventoryOptions,
  type NormalizedInventory,
} from '../packing/catalog.ts';
import { APP_VERSION, PACKING_ALGORITHM_VERSION } from '../version.ts';

export const PLATE_PASS_FORMAT = 1;
const CELLS = STUDS_PER_PLATE * STUDS_PER_PLATE;

export interface PlatePass {
  plate: string;
  /** 32 × 32 heights, data[j*32 + i] (j south→north, i west→east). */
  heights: Int32Array;
  inventory: NormalizedInventory;
  appVersion: string;
  packingVersion: number;
  title: string;
}

class Writer {
  bytes: number[] = [];
  u8(v: number) {
    this.bytes.push(v & 0xff);
  }
  varint(v: number) {
    if (!Number.isInteger(v) || v < 0) throw new Error(`varint must be a non-negative integer, got ${v}`);
    while (v >= 0x80) {
      this.bytes.push((v & 0x7f) | 0x80);
      v = Math.floor(v / 128);
    }
    this.bytes.push(v);
  }
  str(s: string) {
    const b = new TextEncoder().encode(s);
    this.varint(b.length);
    for (const x of b) this.bytes.push(x);
  }
}

class Reader {
  private o = 0;
  private readonly b: Uint8Array;
  constructor(b: Uint8Array) {
    this.b = b;
  }
  u8(): number {
    if (this.o >= this.b.length) throw new Error('plate pass truncated');
    return this.b[this.o++]!;
  }
  varint(): number {
    let v = 0,
      mul = 1;
    for (;;) {
      const x = this.u8();
      v += (x & 0x7f) * mul;
      if (!(x & 0x80)) return v;
      mul *= 128;
      if (mul > 2 ** 49) throw new Error('bad varint');
    }
  }
  str(): string {
    const n = this.varint();
    if (this.o + n > this.b.length) throw new Error('plate pass truncated');
    const s = new TextDecoder().decode(this.b.subarray(this.o, this.o + n));
    this.o += n;
    return s;
  }
}

export function base64UrlEncode(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]!);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function base64UrlDecode(s: string): Uint8Array {
  if (!/^[A-Za-z0-9_-]*$/.test(s)) throw new Error('invalid base64url');
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4);
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function encodePlatePass(p: {
  plate: string;
  heights: ArrayLike<number>;
  inventory?: InventoryOptions;
  title?: string;
}): string {
  if (p.heights.length !== CELLS) throw new Error(`a plate has ${CELLS} studs`);
  const inv = normalizeInventory(p.inventory);
  const w = new Writer();
  w.u8(PLATE_PASS_FORMAT);
  w.u8(PACKING_ALGORITHM_VERSION);
  w.str(APP_VERSION);
  w.str(p.plate);
  w.str(p.title ?? '');
  let mask = 0;
  BRICKS.forEach((b, i) => {
    if (inv.enabled.includes(b.id)) mask |= 1 << i;
  });
  mask |= TILE_CAP_MODES.indexOf(inv.tileCap) << 14;
  w.u8(mask & 0xff);
  w.u8(mask >> 8);
  w.u8(inv.maxLength);
  let i = 0;
  while (i < CELLS) {
    const v = p.heights[i]!;
    let run = 1;
    while (i + run < CELLS && p.heights[i + run] === v) run++;
    w.varint(v);
    w.varint(run);
    i += run;
  }
  return base64UrlEncode(deflateSync(Uint8Array.from(w.bytes), { level: 9 }));
}

export function decodePlatePass(payload: string): PlatePass {
  const r = new Reader(inflateSync(base64UrlDecode(payload)));
  const format = r.u8();
  if (format !== PLATE_PASS_FORMAT) throw new Error(`unsupported plate pass format ${format}`);
  const packingVersion = r.u8();
  const appVersion = r.str();
  const plate = r.str();
  const title = r.str();
  const mask = r.u8() | (r.u8() << 8);
  const maxLength = r.u8();
  const heights = new Int32Array(CELLS);
  let i = 0;
  while (i < CELLS) {
    const v = r.varint();
    const run = r.varint();
    if (run < 1 || i + run > CELLS) throw new Error('bad run length');
    heights.fill(v, i, i + run);
    i += run;
  }
  const enabled = BRICKS.filter((_, k) => mask & (1 << k)).map((b) => b.id);
  const tileCap = TILE_CAP_MODES[(mask >> 14) & 3] ?? 'none';
  return {
    plate,
    heights,
    inventory: normalizeInventory({ enabled, maxLength, tileCap }),
    appVersion,
    packingVersion,
    title,
  };
}

/** QR byte-mode capacity per version 1–40 at error-correction levels L and M. */
const QR_BYTES_L = [
  17, 32, 53, 78, 106, 134, 154, 192, 230, 271, 321, 367, 425, 458, 520, 586, 644, 718, 792, 858, 929, 1003,
  1091, 1171, 1273, 1367, 1465, 1528, 1628, 1732, 1840, 1952, 2068, 2188, 2303, 2431, 2563, 2699, 2809, 2953,
];
const QR_BYTES_M = [
  14, 26, 42, 62, 84, 106, 122, 152, 180, 213, 251, 287, 331, 362, 412, 450, 504, 560, 624, 666, 711, 779,
  857, 911, 997, 1059, 1125, 1190, 1264, 1370, 1452, 1538, 1628, 1722, 1809, 1911, 1989, 2099, 2213, 2331,
];

/** Smallest QR version (1–40) holding `byteLength` bytes in byte mode, or null when none does. */
export function qrVersionFor(byteLength: number, ecc: 'L' | 'M' = 'M'): number | null {
  const table = ecc === 'L' ? QR_BYTES_L : QR_BYTES_M;
  const v = table.findIndex((cap) => cap >= byteLength);
  return v < 0 ? null : v + 1;
}

/** Modules per side of a QR version (17 + 4v). */
export function qrModules(version: number): number {
  return 17 + 4 * version;
}

/** Size facts for a full pass URL (`base` + '#' + fragment key + payload) so the UI can decide on the QR. */
export function platePassUrlInfo(
  baseUrl: string,
  payload: string,
  ecc: 'L' | 'M' = 'M',
  fragmentKey = 'pass=',
) {
  const url = `${baseUrl}#${fragmentKey}${payload}`;
  const bytes = new TextEncoder().encode(url).length;
  const version = qrVersionFor(bytes, ecc);
  return {
    url,
    bytes,
    payloadChars: payload.length,
    qrVersion: version,
    qrModules: version ? qrModules(version) : null,
  };
}

/**
 * Plate pass URL (SPEC O10): `<base>#guide/build/<plate>/1&d=<payload>`. The fragment is
 * never sent to a server; opening it shows Plate mode for that plate on any device.
 */
export function platePassUrl(baseUrl: string, plate: string, payload: string, layer = 1): string {
  return `${baseUrl.replace(/#.*$/, '')}#guide/build/${plate}/${layer}&d=${payload}`;
}

/** QR budget for printed passes (the scannability threshold of SPEC O10): version 15 at ECC M (77 modules, 412 bytes) in a 38 mm square. */
export const PASS_MAX_QR_VERSION = 15;

/** Whether a pass URL still fits a scannable printed QR code. */
export function passFitsQr(
  url: string,
  maxVersion = PASS_MAX_QR_VERSION,
): { fits: boolean; version: number | null; bytes: number } {
  const bytes = new TextEncoder().encode(url).length;
  const version = qrVersionFor(bytes, 'M');
  return { fits: version !== null && version <= maxVersion, version, bytes };
}
