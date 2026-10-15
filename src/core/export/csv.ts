/**
 * Height matrix CSV (SPEC §3.1 step 5, O1), byte-identical to legonizer@1.1.0
 * `generateCSVwithHeightMap`: rows from the northernmost (j = rows − 1) to j = 0, values separated
 * by ';', every row terminated by '\n', no header. The legacy code builds a `data:` URI with
 * encodeURI; the downloaded file holds the percent-decoded string, i.e. exactly these bytes.
 */
import { STUDS_PER_PLATE, type HeightMap } from '../types.ts';
import { plateName } from '../packing/plates.ts';

export function heightMapToCsv(hm: HeightMap): string {
  let out = '';
  for (let j = hm.rows - 1; j >= 0; j--) {
    const row = j * hm.cols;
    for (let i = 0; i < hm.cols; i++) {
      if (i > 0) out += ';';
      out += String(hm.data[row + i]);
    }
    out += '\n';
  }
  return out;
}

export function csvBytes(hm: HeightMap): Uint8Array {
  return new TextEncoder().encode(heightMapToCsv(hm));
}

/**
 * Legacy file name with the actual plate counts (fixes L8: UD-Viz writes `input.step`, always 1).
 */
export function csvFileName(platesX: number, platesY: number): string {
  return `legoPlates_${platesX}_${platesY}.csv`;
}

/** Option of O1: one CSV per baseplate (same format, 32 × 32 values), named after the plate (A1 = north-west). */
export function perPlateCsv(hm: HeightMap): { name: string; plate: string; content: string }[] {
  const px = hm.cols / STUDS_PER_PLATE;
  const py = hm.rows / STUDS_PER_PLATE;
  const out: { name: string; plate: string; content: string }[] = [];
  for (let row = 0; row < py; row++) {
    for (let col = 0; col < px; col++) {
      const sub: HeightMap = {
        cols: STUDS_PER_PLATE,
        rows: STUDS_PER_PLATE,
        data: new Int32Array(STUDS_PER_PLATE * STUDS_PER_PLATE),
      };
      const pj = py - 1 - row; // plate row 1 is the northernmost
      for (let j = 0; j < STUDS_PER_PLATE; j++) {
        for (let i = 0; i < STUDS_PER_PLATE; i++) {
          sub.data[j * STUDS_PER_PLATE + i] =
            hm.data[(pj * STUDS_PER_PLATE + j) * hm.cols + col * STUDS_PER_PLATE + i]!;
        }
      }
      const plate = plateName(col, pj, py);
      out.push({ name: `legoPlate_${plate}.csv`, plate, content: heightMapToCsv(sub) });
    }
  }
  return out;
}

/** Parses a legacy CSV back into a HeightMap (project re-import, tests). */
export function parseHeightMapCsv(text: string): HeightMap {
  const lines = text.split('\n').filter((l) => l.length > 0);
  const rows = lines.length;
  const cols = rows ? lines[0]!.split(';').length : 0;
  const data = new Int32Array(rows * cols);
  lines.forEach((line, r) => {
    const j = rows - 1 - r;
    const vals = line.split(';');
    if (vals.length !== cols) throw new Error(`CSV row ${r + 1} has ${vals.length} values, expected ${cols}`);
    vals.forEach((v, i) => (data[j * cols + i] = Number(v)));
  });
  return { cols, rows, data };
}
