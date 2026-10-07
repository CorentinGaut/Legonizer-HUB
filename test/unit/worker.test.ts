import { describe, expect, it } from 'vitest';
import { EngineClient, EngineRequestError, type WorkerLike } from '../../src/core/worker/client.ts';
import { createEngineHost } from '../../src/core/worker/engine.ts';
import type { EngineRequest, EngineResponse } from '../../src/core/worker/protocol.ts';
import { SYNTHETIC_CENTRE, syntheticBoxesCity } from '../../src/core/samples/synthetic.ts';
import { defaultParams, type Params } from '../../src/core/types.ts';
import { decodePlatePass } from '../../src/core/export/platePass.ts';
import { parseProject } from '../../src/core/export/project.ts';

/** EngineClient ↔ engine host through structuredClone + transfer, like a real Worker. */
function connect(): { client: EngineClient; transferred: number[] } {
  const transferred: number[] = [];
  const port: WorkerLike = {
    onmessage: null,
    postMessage(msg, transfer) {
      const copy = structuredClone(msg, { transfer: transfer ?? [] }) as EngineRequest;
      setTimeout(() => void host.onMessage(copy), 0);
    },
    terminate() {},
  };
  const host = createEngineHost((msg: EngineResponse, transfer) => {
    transferred.push(transfer?.length ?? 0);
    const copy = structuredClone(msg, { transfer: transfer ?? [] });
    setTimeout(() => port.onmessage?.({ data: copy } as MessageEvent), 0);
  });
  return { client: new EngineClient(port), transferred };
}

const area = { cx: SYNTHETIC_CENTRE[0], cy: SYNTHETIC_CENTRE[1], rotationDeg: 0 };

describe('engine worker protocol', () => {
  it('import → estimate → generate → exports, with progress', async () => {
    const { client, transferred } = connect();
    const files = [...syntheticBoxesCity(1)].map(([path, data]) => ({ path, data }));
    const stages = new Set<string>();
    const summary = await client.request('import', { files }, { onProgress: (s) => stages.add(s) }).promise;
    expect(summary.format).toBe('3dtiles');
    expect(summary.stats.features).toBeGreaterThan(50);
    expect(summary.defaultArea.platesX).toBe(4);
    expect(stages.has('import')).toBe(true);

    const est = await client.request('estimate', { area, params: defaultParams(4, 4) }).promise;
    expect(est.maxBricks).toBe(10);

    const progress: number[] = [];
    const gen = await client.request(
      'generate',
      { area, params: { ...defaultParams(2, 2), keepSmall: true } },
      { onProgress: (_s, f) => progress.push(f) },
    ).promise;
    expect(gen.heightmap.heightMap.data).toBeInstanceOf(Int32Array);
    expect(gen.heightmap.heightMap.data.length).toBe(64 * 64);
    expect(gen.packing.total).toBeGreaterThan(0);
    expect(progress.length).toBeGreaterThan(3);
    expect(transferred.some((n) => n > 0)).toBe(true);

    const kinds = [
      'csv',
      'csv-per-plate',
      'bricklink',
      'rebrickable',
      'ldraw',
      'ldraw-mpd',
      'project',
      'calque-png',
      'plate-pass',
    ] as const;
    for (const kind of kinds) {
      const out = await client.request('export', { kind, options: { title: 'Synthetic', dpi: 50 } }).promise;
      expect(out.length).toBeGreaterThan(0);
      for (const f of out) expect(f.data.length).toBeGreaterThan(0);
    }
    const csv = await client.request('export', { kind: 'csv' }).promise;
    expect(csv[0]!.name).toBe('legoPlates_2_2.csv');
    const passes = await client.request('export', { kind: 'plate-pass' }).promise;
    expect(passes.map((p) => decodePlatePass(p.data as string).plate)).toEqual(['A1', 'B1', 'A2', 'B2']);
    const proj = await client.request('export', { kind: 'project' }).promise;
    expect(parseProject(proj[0]!.data as string).inputs).toHaveLength(5);

    const preview = await client.request('mesh-preview', {}).promise;
    expect(preview.positions.length).toBe(summary.stats.triangles * 9);
  });

  it('cancel aborts a running generation; errors carry codes', async () => {
    const { client } = connect();
    const files = [...syntheticBoxesCity(1)].map(([path, data]) => ({ path, data }));
    await client.request('import', { files }).promise;
    const heavy = { ...defaultParams(4, 4), sampling: 'supersample-4', rotation: 'rotate' } as Params;
    let cancelled = false;
    const job = client.request(
      'generate',
      { area, params: heavy },
      {
        onProgress: (_s, f) => {
          if (f > 0.1 && !cancelled) {
            cancelled = true;
            job.cancel();
          }
        },
      },
    );
    const err = await job.promise.catch((e: unknown) => e);
    expect(err).toBeInstanceOf(EngineRequestError);
    expect((err as EngineRequestError).code).toBe('cancelled');
    // the engine is still usable after a cancel
    const ok = await client.request('generate', { area, params: defaultParams(1, 1) }).promise;
    expect(ok.heightmap.heightMap.cols).toBe(32);
    const bad = await client
      .request('generate', { area, params: { ...defaultParams(), scale: -1 } })
      .promise.catch((e: unknown) => e);
    expect((bad as EngineRequestError).code).toBe('invalid-params');
    const { client: fresh } = connect();
    const none = await fresh
      .request('estimate', { area, params: defaultParams() })
      .promise.catch((e: unknown) => e);
    expect((none as EngineRequestError).code).toBe('empty-geometry');
    const unsupported = await fresh
      .request('import', { files: [{ path: 'notes.txt', data: new TextEncoder().encode('x') }] })
      .promise.catch((e: unknown) => e);
    expect((unsupported as EngineRequestError).code).toBe('unsupported-format');
  });
});
