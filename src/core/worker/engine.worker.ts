/// <reference lib="webworker" />
/**
 * Engine Worker entry. Create it from the UI with
 *   new Worker(new URL('../core/worker/engine.worker.ts', import.meta.url), { type: 'module' })
 * and talk to it through EngineClient (client.ts).
 */
import { createEngineHost } from './engine.ts';
import type { EngineRequest } from './protocol.ts';

declare const self: DedicatedWorkerGlobalScope;

const host = createEngineHost((msg, transfer) => self.postMessage(msg, transfer ?? []));
self.onmessage = (e: MessageEvent<EngineRequest>) => {
  void host.onMessage(e.data);
};
