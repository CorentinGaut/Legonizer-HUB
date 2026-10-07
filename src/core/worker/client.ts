/**
 * Promise API over the engine Worker (SPEC G1, I11): progress callbacks, cancel, typed results.
 *
 * Cancellation: `cancel()` aborts heightmap and packing at their next yield (a few ms). Parsing a
 * single file and building the BVH are not interruptible; for those, `terminate()` kills the
 * Worker (the imported model is lost and must be re-imported).
 */
import type { EngineErrorCode } from '../util/errors.ts';
import type { EngineRequest, EngineResponse, ResultMap } from './protocol.ts';

export interface WorkerLike {
  postMessage(msg: unknown, transfer?: Transferable[]): void;
  onmessage: ((e: MessageEvent) => void) | null;
  terminate(): void;
}

export class EngineRequestError extends Error {
  readonly code: EngineErrorCode | 'internal';
  readonly details: Record<string, unknown> | undefined;
  constructor(code: EngineErrorCode | 'internal', message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = 'EngineRequestError';
    this.code = code;
    this.details = details;
  }
}

export interface Pending<T> {
  id: number;
  promise: Promise<T>;
  cancel(): void;
}

type Payload<K extends keyof ResultMap> = Omit<Extract<EngineRequest, { type: K }>, 'id' | 'type'>;

export class EngineClient {
  private nextId = 1;
  private readonly waiting = new Map<
    number,
    {
      resolve: (v: unknown) => void;
      reject: (e: unknown) => void;
      progress?: (stage: string, f: number, detail?: string) => void;
    }
  >();
  private readonly worker: WorkerLike;

  constructor(worker: WorkerLike) {
    this.worker = worker;
    worker.onmessage = (e: MessageEvent<EngineResponse>) => this.receive(e.data);
  }

  private receive(msg: EngineResponse) {
    const w = this.waiting.get(msg.id);
    if (!w) return;
    if (msg.type === 'progress') w.progress?.(msg.stage, msg.fraction, msg.detail);
    else {
      this.waiting.delete(msg.id);
      if (msg.type === 'result') w.resolve(msg.result);
      else w.reject(new EngineRequestError(msg.code, msg.message, msg.details));
    }
  }

  request<K extends keyof ResultMap>(
    type: K,
    payload: Payload<K>,
    opts: {
      onProgress?: (stage: string, fraction: number, detail?: string) => void;
      transfer?: Transferable[];
    } = {},
  ): Pending<ResultMap[K]> {
    const id = this.nextId++;
    const promise = new Promise<ResultMap[K]>((resolve, reject) => {
      this.waiting.set(id, {
        resolve: resolve as (v: unknown) => void,
        reject,
        ...(opts.onProgress ? { progress: opts.onProgress } : {}),
      });
    });
    this.worker.postMessage({ id, type, ...payload }, opts.transfer ?? []);
    return {
      id,
      promise,
      cancel: () => this.worker.postMessage({ id: this.nextId++, type: 'cancel', target: id }),
    };
  }

  terminate(): void {
    this.worker.terminate();
    for (const [, w] of this.waiting) w.reject(new EngineRequestError('cancelled', 'Engine terminated'));
    this.waiting.clear();
  }
}
