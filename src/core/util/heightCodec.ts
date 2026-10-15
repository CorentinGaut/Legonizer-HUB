/** Run-length (varint value, varint run) + raw deflate + base64url codec for integer height grids. */
import { deflateSync, inflateSync } from 'fflate';
import { base64UrlDecode, base64UrlEncode } from '../export/platePass.ts';

export function encodeHeights(data: ArrayLike<number>): string {
  const bytes: number[] = [];
  const varint = (v: number) => {
    if (!Number.isInteger(v) || v < 0) throw new Error(`heights must be non-negative integers, got ${v}`);
    while (v >= 0x80) {
      bytes.push((v & 0x7f) | 0x80);
      v = Math.floor(v / 128);
    }
    bytes.push(v);
  };
  let i = 0;
  while (i < data.length) {
    const v = data[i]!;
    let run = 1;
    while (i + run < data.length && data[i + run] === v) run++;
    varint(v);
    varint(run);
    i += run;
  }
  return base64UrlEncode(deflateSync(Uint8Array.from(bytes), { level: 9 }));
}

export function decodeHeights(s: string, length: number): Int32Array {
  const b = inflateSync(base64UrlDecode(s));
  const out = new Int32Array(length);
  let o = 0,
    i = 0;
  const varint = () => {
    let v = 0,
      mul = 1;
    for (;;) {
      if (o >= b.length) throw new Error('height data truncated');
      const x = b[o++]!;
      v += (x & 0x7f) * mul;
      if (!(x & 0x80)) return v;
      mul *= 128;
    }
  };
  while (i < length) {
    const v = varint();
    const run = varint();
    if (run < 1 || i + run > length) throw new Error('bad run length');
    out.fill(v, i, i + run);
    i += run;
  }
  return out;
}
