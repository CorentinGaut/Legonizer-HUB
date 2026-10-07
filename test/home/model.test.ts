/**
 * The home brick model (SPEC H4): packed at build time by the real packer from the pipeline
 * fixture. Checks that what the animation shows is an exact brick cover of the fixture heights.
 */
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildHomeModel } from '../../scripts/vite/home-model.ts';
import { deriveUrbanData } from '../../src/home/scene/derive.ts';

const fixture = join(import.meta.dirname, '..', '..', 'src', 'data', 'home', 'part-dieu-home.json');

describe('home brick model', () => {
  const { model, fixture: f } = buildHomeModel(fixture);

  it('uses the 5 × 3 plate fixture produced by our pipeline (storyboard §1.1)', () => {
    expect(f.kind).toBe('legonizer-home-heightmap');
    expect([model.platesX, model.platesY]).toEqual([5, 3]);
    expect([model.cols, model.rows]).toEqual([160, 96]);
    expect(model.maxLayer).toBeLessThanOrEqual(24);
  });

  it('covers every stud column exactly up to its height, plate by plate', () => {
    const { cols, rows, heights, bricks } = model;
    const count = new Uint16Array(cols * rows * (model.maxLayer + 1));
    for (let o = 0; o < bricks.length; o += 8) {
      const [pc, pr, layer, x, y, w, d] = bricks.subarray(o, o + 7);
      const southRow = model.platesY - 1 - pr!;
      expect(x! + w!).toBeLessThanOrEqual(32); // no brick crosses a plate edge
      expect(y! + d!).toBeLessThanOrEqual(32);
      for (let j = southRow * 32 + y!; j < southRow * 32 + y! + d!; j++)
        for (let i = pc! * 32 + x!; i < pc! * 32 + x! + w!; i++)
          count[(j * cols + i) * (model.maxLayer + 1) + layer!]!++;
    }
    for (let c = 0; c < cols * rows; c++)
      for (let k = 1; k <= model.maxLayer; k++)
        expect(count[c * (model.maxLayer + 1) + k]).toBe(k <= heights[c]! ? 1 : 0);
  });

  it('matches the part counts recorded in the fixture', () => {
    const counts: Record<string, number> = {};
    for (let o = 0; o < model.bricks.length; o += 8) {
      const part = model.parts[model.bricks[o + 7]!]!;
      counts[part] = (counts[part] ?? 0) + 1;
    }
    expect(counts).toEqual(f.summary.counts);
    expect(model.bricks.length / 8).toBe(f.summary.totalBricks);
  });

  it('derives the illustrative urban data deterministically', () => {
    const a = deriveUrbanData(model.cols, model.rows, model.heights);
    const b = deriveUrbanData(model.cols, model.rows, model.heights);
    expect(a.buildings.map((x) => [x.fn, x.change])).toEqual(b.buildings.map((x) => [x.fn, x.change]));
    expect(a.trams).toEqual(b.trams);
    const changes = a.buildings.filter((x) => x.change);
    expect(new Set(changes.map((x) => x.change))).toEqual(new Set(['built', 'demolished', 'modified']));
    expect(a.trams.length).toBeGreaterThan(0);
    // green spaces only on empty ground
    for (let c = 0; c < a.green.length; c++) if (a.green[c]) expect(model.heights[c]).toBe(0);
  });
});
