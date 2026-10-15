/**
 * Build-guide model shared by the 3D instructions (O4), the PDF (O5) and the plate passes (O10):
 * one step per (baseplate, layer) with the bricks placed and the per-step parts callout
 * ("this step: 4× 2×4, 2× 1×2").
 */
import type { HeightMap, PlacedBrick } from '../types.ts';
import { ALL_PARTS } from '../packing/catalog.ts';
import type { PackingResult } from '../packing/pack.ts';

export interface GuideStep {
  plate: string;
  layer: number;
  /** Number of layers of this plate. */
  layers: number;
  bricks: PlacedBrick[];
  callout: { partId: string; name: string; quantity: number }[];
}

export interface PlateGuide {
  plate: string;
  col: number;
  southRow: number;
  maxHeight: number;
  bricks: number;
  steps: GuideStep[];
}

export function buildGuide(packing: Pick<PackingResult, 'bricks' | 'plates'>): PlateGuide[] {
  const byPlate = new Map<string, PlacedBrick[]>();
  for (const b of packing.bricks) {
    let l = byPlate.get(b.plate);
    if (!l) byPlate.set(b.plate, (l = []));
    l.push(b);
  }
  return packing.plates.map((p) => {
    const bricks = byPlate.get(p.plate) ?? [];
    const steps: GuideStep[] = [];
    for (let k = 1; k <= p.layers; k++) {
      const layerBricks = bricks.filter((b) => b.layer === k);
      const callout = ALL_PARTS.map((part) => ({
        partId: part.id,
        name: part.name,
        quantity: layerBricks.filter((b) => b.partId === part.id).length,
      })).filter((c) => c.quantity > 0);
      steps.push({ plate: p.plate, layer: k, layers: p.layers, bricks: layerBricks, callout });
    }
    return {
      plate: p.plate,
      col: p.col,
      southRow: p.southRow,
      maxHeight: p.layers,
      bricks: bricks.length,
      steps,
    };
  });
}

/** 32 × 32 heights of one plate (data[j*32 + i]). */
export function plateHeights(hm: HeightMap, col: number, southRow: number): Int32Array {
  const out = new Int32Array(32 * 32);
  for (let y = 0; y < 32; y++)
    for (let x = 0; x < 32; x++) out[y * 32 + x] = hm.data[(southRow * 32 + y) * hm.cols + col * 32 + x]!;
  return out;
}

/** Height histogram (value → number of studs), for the G3 summary. */
export function heightHistogram(hm: HeightMap): number[] {
  const h: number[] = [];
  for (const v of hm.data) h[v] = (h[v] ?? 0) + 1;
  return Array.from(h, (x) => x ?? 0);
}
