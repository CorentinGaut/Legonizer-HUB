/**
 * The home brick model: heights and packed bricks of the H4 fixture (virtual:lz-home-model,
 * packed at build time by the real packer), in global stud coordinates.
 */
import * as data from 'virtual:lz-home-model';

export interface ModelBrick {
  /** Global stud column of the west edge (0 = west edge of the model). */
  gx: number;
  /** Global stud row of the south edge (0 = south edge of the model). */
  gy: number;
  w: number;
  d: number;
  layer: number;
  /** Plate order A1, B1, C1… (row by row from the north). */
  plateOrder: number;
  part: string;
}

export interface HomeModel {
  cols: number;
  rows: number;
  platesX: number;
  platesY: number;
  maxLayer: number;
  heights: Uint8Array;
  bricks: ModelBrick[];
  meta: typeof data.meta;
}

function decode(b64: string): Uint8Array {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let k = 0; k < s.length; k++) out[k] = s.charCodeAt(k);
  return out;
}

let cached: HomeModel | undefined;

export function loadHomeModel(): HomeModel {
  if (cached) return cached;
  const heights = decode(data.heightsB64);
  const raw = decode(data.bricksB64);
  const bricks: ModelBrick[] = [];
  for (let o = 0; o < raw.length; o += 8) {
    const plateCol = raw[o]!,
      plateRow = raw[o + 1]!;
    const southRow = data.platesY - 1 - plateRow;
    bricks.push({
      gx: plateCol * 32 + raw[o + 3]!,
      gy: southRow * 32 + raw[o + 4]!,
      w: raw[o + 5]!,
      d: raw[o + 6]!,
      layer: raw[o + 2]!,
      plateOrder: plateRow * data.platesX + plateCol,
      part: data.parts[raw[o + 7]!]!,
    });
  }
  cached = {
    cols: data.cols,
    rows: data.rows,
    platesX: data.platesX,
    platesY: data.platesY,
    maxLayer: data.maxLayer,
    heights,
    bricks,
    meta: data.meta,
  };
  return cached;
}
