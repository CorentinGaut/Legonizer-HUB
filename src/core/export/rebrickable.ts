/**
 * Rebrickable parts list CSV (SPEC O7): header `Part,Color,Quantity`, Rebrickable colour ids
 * (White = 15, from Rebrickable's database export colors.csv,
 * https://cdn.rebrickable.com/media/downloads/colors.csv.gz). Part ids are Rebrickable part_num
 * values (parts.csv), identical to BrickLink's for the 12 parts used. The help page describing the
 * import format (https://rebrickable.com/help/import-parts/) sits behind a bot challenge and could
 * not be fetched on 2026-10-06; the column set follows the spec and Rebrickable's own exports.
 */
import { COLOR_WHITE } from '../packing/catalog.ts';
import type { PackingResult } from '../packing/pack.ts';
import { partLines } from './parts.ts';

export function rebrickableCsv(
  packing: Pick<PackingResult, 'counts' | 'baseplates'>,
  includeBaseplates = true,
): string {
  let out = 'Part,Color,Quantity\n';
  for (const p of partLines(packing, includeBaseplates))
    out += `${p.partId},${COLOR_WHITE.rebrickable},${p.quantity}\n`;
  return out;
}
