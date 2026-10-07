/**
 * LDraw model export (SPEC O8), for BrickLink Studio / LeoCAD.
 *
 * Facts (LDraw File Format 1.0.2, https://www.ldraw.org/article/218.html; MPD extension,
 * https://www.ldraw.org/article/47.html; part files from https://library.ldraw.org, 2026-10-06):
 * - 1 stud = 20 LDU, brick height = 24 LDU, plate = 8 LDU; right-handed, −Y is up.
 * - Line type 1: `1 <colour> x y z a b c d e f g h i <file>` (a…i: row-major 3×3 matrix).
 * - MPD: `0 FILE <name>` … `0 NOFILE`; the first file is the main model.
 * - Every brick part (3005 … 3007) has its origin at the centre of its top face, body from y = 0
 *   to y = 24, long side along X, short side along Z. Baseplate 3811: top face at y = 0, ±320 LDU.
 * - Colour 15 = White (LDConfig.ldr).
 *
 * Mapping (no mirroring): LDraw +X = east, +Z = north, −Y = up. A brick of layer k sits with its
 * top face at y = −24·k; a part whose long side runs north is rotated 90° about Y (X → +Z).
 * One `0 STEP` per layer so the builder apps show layer-by-layer steps.
 */
import { STUDS_PER_PLATE, type PlacedBrick } from '../types.ts';
import { BASEPLATE, COLOR_WHITE, partById } from '../packing/catalog.ts';
import type { PackingResult } from '../packing/pack.ts';
import { parsePlateName } from '../packing/plates.ts';

const LDU_PER_STUD = 20;
const LDU_PER_BRICK = 24;
const IDENTITY = '1 0 0 0 1 0 0 0 1';
const ROT_NORTH = '0 0 -1 0 1 0 1 0 0'; // part X axis → +Z (north)

export interface LdrawOptions {
  title?: string;
  author?: string;
}

function brickLine(b: PlacedBrick, offX: number, offZ: number): string {
  const part = partById(b.partId);
  if (!part) throw new Error(`unknown part ${b.partId}`);
  const x = (b.x + b.w / 2) * LDU_PER_STUD + offX;
  const z = (b.y + b.d / 2) * LDU_PER_STUD + offZ;
  const y = -LDU_PER_BRICK * b.layer;
  const m = b.rotation === 90 && part.width !== part.length ? ROT_NORTH : IDENTITY;
  return `1 ${COLOR_WHITE.ldraw} ${x} ${y} ${z} ${m} ${part.ldrawFile}`;
}

function plateBody(bricks: PlacedBrick[], offX: number, offZ: number): string[] {
  const lines: string[] = [];
  lines.push(
    `1 ${COLOR_WHITE.ldraw} ${offX + 16 * LDU_PER_STUD} 0 ${offZ + 16 * LDU_PER_STUD} ${IDENTITY} ${BASEPLATE.ldrawFile}`,
  );
  lines.push('0 STEP');
  const byLayer = new Map<number, PlacedBrick[]>();
  for (const b of bricks) {
    let l = byLayer.get(b.layer);
    if (!l) byLayer.set(b.layer, (l = []));
    l.push(b);
  }
  for (const layer of [...byLayer.keys()].sort((a, b) => a - b)) {
    for (const b of byLayer.get(layer)!) lines.push(brickLine(b, offX, offZ));
    lines.push('0 STEP');
  }
  return lines;
}

function header(name: string, opts: LdrawOptions): string[] {
  return [
    `0 ${opts.title ?? 'Legonizer model'}`,
    `0 Name: ${name}`,
    `0 Author: ${opts.author ?? 'Legonizer'}`,
    '0 BFC CERTIFY CCW',
  ];
}

/** Single .ldr: every plate placed in one model (whole model centred on the origin). */
export function ldrawModel(
  packing: Pick<PackingResult, 'bricks' | 'plates'>,
  platesY: number,
  opts: LdrawOptions = {},
): string {
  const px = Math.max(...packing.plates.map((p) => p.col)) + 1;
  const lines = header('legonizer.ldr', opts);
  for (const plate of packing.plates) {
    const offX = (plate.col * STUDS_PER_PLATE - (px * STUDS_PER_PLATE) / 2) * LDU_PER_STUD;
    const offZ = (plate.southRow * STUDS_PER_PLATE - (platesY * STUDS_PER_PLATE) / 2) * LDU_PER_STUD;
    lines.push(`0 // Baseplate ${plate.plate}`);
    lines.push(
      ...plateBody(
        packing.bricks.filter((b) => b.plate === plate.plate),
        offX,
        offZ,
      ),
    );
  }
  return lines.join('\r\n') + '\r\n';
}

/** MPD: main model referencing one submodel per baseplate (`plate-A1.ldr`, …). */
export function ldrawMpd(
  packing: Pick<PackingResult, 'bricks' | 'plates'>,
  platesY: number,
  opts: LdrawOptions = {},
): string {
  const px = Math.max(...packing.plates.map((p) => p.col)) + 1;
  const out: string[] = ['0 FILE legonizer.ldr', ...header('legonizer.ldr', opts)];
  for (const plate of packing.plates) {
    const { col, southRow } = parsePlateName(plate.plate, platesY);
    const x = (col * STUDS_PER_PLATE + 16 - (px * STUDS_PER_PLATE) / 2) * LDU_PER_STUD;
    const z = (southRow * STUDS_PER_PLATE + 16 - (platesY * STUDS_PER_PLATE) / 2) * LDU_PER_STUD;
    out.push(`1 ${COLOR_WHITE.ldraw} ${x} 0 ${z} ${IDENTITY} plate-${plate.plate}.ldr`);
  }
  out.push('0 NOFILE');
  for (const plate of packing.plates) {
    const name = `plate-${plate.plate}.ldr`;
    out.push(
      `0 FILE ${name}`,
      ...header(name, { ...opts, title: `${opts.title ?? 'Legonizer model'} — baseplate ${plate.plate}` }),
    );
    // submodel coordinates are relative to the baseplate centre
    out.push(
      ...plateBody(
        packing.bricks.filter((b) => b.plate === plate.plate),
        -16 * LDU_PER_STUD,
        -16 * LDU_PER_STUD,
      ),
    );
    out.push('0 NOFILE');
  }
  return out.join('\r\n') + '\r\n';
}
