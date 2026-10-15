import { ALL_PARTS, BASEPLATE } from '../packing/catalog.ts';
import type { PackingResult } from '../packing/pack.ts';

export interface PartLine {
  partId: string;
  name: string;
  quantity: number;
}

/** Parts list in catalog order (bricks 1×1 … 2×8, then cap tiles), then baseplates; zero quantities omitted. */
export function partLines(
  packing: Pick<PackingResult, 'counts' | 'baseplates'>,
  includeBaseplates = true,
): PartLine[] {
  const lines: PartLine[] = [];
  for (const b of ALL_PARTS) {
    const q = packing.counts[b.id] ?? 0;
    if (q > 0) lines.push({ partId: b.id, name: b.name, quantity: q });
  }
  if (includeBaseplates && packing.baseplates.quantity > 0) {
    lines.push({ partId: BASEPLATE.id, name: BASEPLATE.name, quantity: packing.baseplates.quantity });
  }
  return lines;
}
