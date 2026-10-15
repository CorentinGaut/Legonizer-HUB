/**
 * Batched 3D Model (b3dm) parser — 3D Tiles 1.0,
 * https://github.com/CesiumGS/3d-tiles/tree/main/specification/TileFormats/Batched3DModel
 *
 * Layout: 28-byte header (magic "b3dm", version 1, byteLength, featureTableJSONByteLength,
 * featureTableBinaryByteLength, batchTableJSONByteLength, batchTableBinaryByteLength), feature
 * table (JSON + binary), batch table (JSON + binary), then an embedded GLB.
 */
import { EngineError } from '../util/errors.ts';
import { dataView, decodeUtf8, parseJsonBytes } from '../util/bytes.ts';

/* eslint-disable @typescript-eslint/no-explicit-any */

export interface B3dm {
  batchLength: number;
  rtcCenter: [number, number, number] | null;
  /** Batch table as columns: property name → per-batch values (binary properties decoded to numbers). */
  batchTable: Record<string, unknown[]>;
  glb: Uint8Array;
}

const COMPONENT: Record<string, { size: number; read: (dv: DataView, o: number) => number }> = {
  BYTE: { size: 1, read: (dv, o) => dv.getInt8(o) },
  UNSIGNED_BYTE: { size: 1, read: (dv, o) => dv.getUint8(o) },
  SHORT: { size: 2, read: (dv, o) => dv.getInt16(o, true) },
  UNSIGNED_SHORT: { size: 2, read: (dv, o) => dv.getUint16(o, true) },
  INT: { size: 4, read: (dv, o) => dv.getInt32(o, true) },
  UNSIGNED_INT: { size: 4, read: (dv, o) => dv.getUint32(o, true) },
  FLOAT: { size: 4, read: (dv, o) => dv.getFloat32(o, true) },
  DOUBLE: { size: 8, read: (dv, o) => dv.getFloat64(o, true) },
};
const TYPE: Record<string, number> = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 };

function decodeBinaryProperty(def: any, bin: Uint8Array, count: number): unknown[] {
  const comp = COMPONENT[def.componentType as string];
  const n = TYPE[def.type as string] ?? 1;
  if (!comp) return [];
  const dv = dataView(bin);
  const out: unknown[] = [];
  for (let i = 0; i < count; i++) {
    const base = (def.byteOffset ?? 0) + i * n * comp.size;
    if (base + n * comp.size > bin.length) break;
    if (n === 1) out.push(comp.read(dv, base));
    else out.push(Array.from({ length: n }, (_, k) => comp.read(dv, base + k * comp.size)));
  }
  return out;
}

export function isB3dm(bytes: Uint8Array): boolean {
  return (
    bytes.length >= 4 && bytes[0] === 0x62 && bytes[1] === 0x33 && bytes[2] === 0x64 && bytes[3] === 0x6d
  );
}

export function parseB3dm(bytes: Uint8Array, label = 'b3dm'): B3dm {
  if (!isB3dm(bytes)) throw new EngineError('invalid-file', `${label}: not a b3dm tile (bad magic)`);
  if (bytes.length < 28) throw new EngineError('invalid-file', `${label}: truncated b3dm header`);
  const dv = dataView(bytes);
  const version = dv.getUint32(4, true);
  if (version !== 1) throw new EngineError('invalid-file', `${label}: unsupported b3dm version ${version}`);
  let ftJsonLength = dv.getUint32(12, true);
  let ftBinLength = dv.getUint32(16, true);
  let btJsonLength = dv.getUint32(20, true);
  let btBinLength = dv.getUint32(24, true);
  let headerLength = 28;
  let legacyBatchLength: number | null = null;
  // Legacy headers (pre-1.0), detected like CesiumJS's Batched3DModel3DTileContent:
  // [batchLength, batchTableByteLength] (20 bytes) or [batchTableJsonByteLength, batchTableBinaryByteLength, batchLength] (24 bytes).
  if (btJsonLength >= 570425344) {
    headerLength = 20;
    legacyBatchLength = ftJsonLength;
    btJsonLength = ftBinLength;
    btBinLength = 0;
    ftJsonLength = 0;
    ftBinLength = 0;
  } else if (btBinLength >= 570425344) {
    headerLength = 24;
    legacyBatchLength = btJsonLength;
    btJsonLength = ftJsonLength;
    btBinLength = ftBinLength;
    ftJsonLength = 0;
    ftBinLength = 0;
  }
  let o = headerLength;
  const ftJson: any = ftJsonLength > 0 ? parseJsonBytes(bytes.subarray(o, o + ftJsonLength)) : {};
  o += ftJsonLength;
  const ftBin = bytes.subarray(o, o + ftBinLength);
  o += ftBinLength;
  const btJson: any = btJsonLength > 0 ? parseJsonBytes(bytes.subarray(o, o + btJsonLength)) : {};
  o += btJsonLength;
  const btBin = bytes.subarray(o, o + btBinLength);
  o += btBinLength;
  const glb = bytes.subarray(o);

  const batchLength: number = legacyBatchLength ?? ftJson.BATCH_LENGTH ?? 0;
  let rtcCenter: [number, number, number] | null = null;
  const rtc = ftJson.RTC_CENTER;
  if (Array.isArray(rtc) && rtc.length === 3) rtcCenter = [rtc[0], rtc[1], rtc[2]];
  else if (rtc && typeof rtc.byteOffset === 'number' && ftBin.length >= rtc.byteOffset + 12) {
    const fdv = dataView(ftBin);
    rtcCenter = [0, 1, 2].map((k) => fdv.getFloat32(rtc.byteOffset + 4 * k, true)) as [
      number,
      number,
      number,
    ];
  }

  const batchTable: Record<string, unknown[]> = {};
  for (const [name, value] of Object.entries(btJson)) {
    if (name === 'extensions' || name === 'extras') continue;
    if (Array.isArray(value)) batchTable[name] = value;
    else if (value && typeof value === 'object' && typeof (value as any).byteOffset === 'number') {
      batchTable[name] = decodeBinaryProperty(value, btBin, batchLength);
    }
  }
  if (glb.length < 12) throw new EngineError('invalid-file', `${label}: b3dm has no embedded glTF`);
  if (glb[0] !== 0x67 || glb[1] !== 0x6c || glb[2] !== 0x54 || glb[3] !== 0x46) {
    // b3dm may reference an external glTF by URI (rare, 3D Tiles 1.0 allows only embedded GLB)
    const maybeUri = decodeUtf8(glb).trim();
    throw new EngineError('invalid-file', `${label}: embedded glTF is not a GLB (${maybeUri.slice(0, 40)}…)`);
  }
  return { batchLength, rtcCenter, batchTable, glb };
}
