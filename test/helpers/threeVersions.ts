/**
 * Loads the exact three.js builds the legacy pipeline ran on:
 * - three r147: nested dependency of legonizer@1.1.0 (used by createHeightMapFromBufferGeometry)
 * - three r154: the peer dependency of @ud-viz/widget_legonizer 4.6.1 / iTowns 2.41.1-next.9
 *   (used by MockUpUtils and the iTowns tile/feature code), installed as the alias `three-r154`.
 */
import { createRequire } from 'node:module';
import { resolve } from 'node:path';

import type * as ThreeNamespace from 'three';

type Three = typeof ThreeNamespace;

const root = resolve(import.meta.dirname, '..', '..');
const requireFromLegonizer = createRequire(resolve(root, 'node_modules/legonizer/package.json'));
const requireFromRoot = createRequire(resolve(root, 'package.json'));

export const THREE147 = requireFromLegonizer('three') as Three;
export const THREE154 = requireFromRoot('three-r154') as Three;

export interface LegonizerApi {
  createHeightMapFromBufferGeometry(
    geometry: unknown,
    area: unknown,
    xPlates: number,
    yPlates: number,
    maxLegoHeight?: number,
  ): number[][];
}
export const legonizer = requireFromRoot('legonizer') as LegonizerApi;

if (THREE147.REVISION !== '147')
  throw new Error(`expected three r147 under legonizer, got ${THREE147.REVISION}`);
if (THREE154.REVISION !== '154') throw new Error(`expected three r154 alias, got ${THREE154.REVISION}`);
