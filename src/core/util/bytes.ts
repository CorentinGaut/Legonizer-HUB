const utf8 = new TextDecoder('utf-8');

export function decodeUtf8(bytes: Uint8Array): string {
  // strip a UTF-8 BOM if present
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf)
    bytes = bytes.subarray(3);
  return utf8.decode(bytes);
}

/** JSON.parse of a byte range, tolerant of the trailing space/NUL padding used by 3D Tiles and GLB chunks. */
export function parseJsonBytes(bytes: Uint8Array): unknown {
  let end = bytes.length;
  while (end > 0 && (bytes[end - 1] === 0x20 || bytes[end - 1] === 0x00)) end--;
  return JSON.parse(decodeUtf8(bytes.subarray(0, end)));
}

export function dataView(bytes: Uint8Array): DataView {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

export function base64ToBytes(b64: string): Uint8Array {
  if (typeof atob === 'function') {
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }
  throw new Error('base64 decoding unavailable');
}
