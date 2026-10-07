/**
 * Baseplate naming (SPEC A6): columns A, B, C… west→east, rows 1, 2, 3… north→south,
 * A1 = north-west, same orientation as the CSV (north first).
 */
import { STUDS_PER_PLATE } from '../types.ts';

export function columnLetters(col: number): string {
  let s = '';
  let n = col + 1;
  while (n > 0) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

/** @param col plate column from the west (0-based); @param southRow plate row from the south (0-based). */
export function plateName(col: number, southRow: number, platesY: number): string {
  return `${columnLetters(col)}${platesY - southRow}`;
}

/** Plate of a heightmap cell (i west→east, j south→north). */
export function plateOfCell(
  i: number,
  j: number,
  platesY: number,
): { col: number; southRow: number; name: string } {
  const col = Math.floor(i / STUDS_PER_PLATE);
  const southRow = Math.floor(j / STUDS_PER_PLATE);
  return { col, southRow, name: plateName(col, southRow, platesY) };
}

export function parsePlateName(name: string, platesY: number): { col: number; southRow: number } {
  const m = /^([A-Z]+)(\d+)$/.exec(name);
  if (!m) throw new Error(`bad plate name ${name}`);
  let col = 0;
  for (const ch of m[1]!) col = col * 26 + (ch.charCodeAt(0) - 64);
  return { col: col - 1, southRow: platesY - Number(m[2]) };
}
