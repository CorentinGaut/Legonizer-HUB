/**
 * Engine service for the page: starts the engine Worker on first use (three.js, the BVH, pdf-lib
 * and the importers stay in the Worker chunk, N5) and restarts it when a non-interruptible job is
 * cancelled (parsing a file, building the BVH: ux-spec §6.3).
 */
import { createEngineClient } from '../core/worker/browser.ts';
import { EngineRequestError, type EngineClient, type Pending } from '../core/worker/client.ts';
import type { EngineRequest, ResultMap } from '../core/worker/protocol.ts';

type Payload<K extends keyof ResultMap> = Omit<Extract<EngineRequest, { type: K }>, 'id' | 'type'>;
type ProgressCb = (stage: string, fraction: number, detail?: string) => void;

export class EngineService {
  private client: EngineClient | null = null;
  /** Bumped on restart: callers ignore results of an older generation. */
  generation = 0;
  onRestart: (() => void) | null = null;

  get(): EngineClient {
    if (!this.client) this.client = createEngineClient();
    return this.client;
  }

  request<K extends keyof ResultMap>(
    type: K,
    payload: Payload<K>,
    opts: { onProgress?: ProgressCb; transfer?: Transferable[] } = {},
  ): Pending<ResultMap[K]> {
    return this.get().request(type, payload, opts);
  }

  /** Kills the Worker (loses the imported model) and starts a fresh one on next use. */
  restart(): void {
    this.client?.terminate();
    this.client = null;
    this.generation++;
    this.onRestart?.();
  }
}

export function isCancel(e: unknown): boolean {
  return e instanceof EngineRequestError && e.code === 'cancelled';
}

export function errorCode(e: unknown): string {
  if (e instanceof EngineRequestError) return e.code;
  return 'internal';
}

export function errorText(e: unknown): string {
  if (e instanceof Error) return `${e.name}: ${e.message}`;
  return String(e);
}

/** Out-of-memory failures surface as RangeError / allocation messages from the Worker. */
export function isOutOfMemory(e: unknown): boolean {
  const m = e instanceof Error ? e.message : String(e);
  return /out of memory|allocation failed|Array buffer allocation|Invalid typed array length|RangeError/i.test(
    m,
  );
}
