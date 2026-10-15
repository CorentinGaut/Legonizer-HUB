/**
 * Long computations are written as generators that `yield` their progress now and then. Driven by
 * `runSync` (Node, tests) they run straight through; driven by `runAsync` (the Worker) they give
 * the event loop a turn about every `sliceMs`, so a `cancel` message can abort them — a plain
 * Worker cannot otherwise receive messages during a synchronous loop, and SharedArrayBuffer flags
 * would need cross-origin isolation headers that GitHub Pages cannot set.
 */
import { throwIfAborted } from './errors.ts';

export type Steps<T> = Generator<number, T, void>;

export function runSync<T>(g: Steps<T>): T {
  for (;;) {
    const r = g.next();
    if (r.done) return r.value;
  }
}

function macrotask(): Promise<void> {
  if (typeof MessageChannel !== 'undefined') {
    return new Promise((resolve) => {
      const ch = new MessageChannel();
      ch.port1.onmessage = () => {
        ch.port1.close();
        resolve();
      };
      ch.port2.postMessage(0);
    });
  }
  return new Promise((resolve) => setTimeout(resolve, 0));
}

export async function runAsync<T>(g: Steps<T>, signal?: AbortSignal, sliceMs = 30): Promise<T> {
  let last = performance.now();
  for (;;) {
    const r = g.next();
    if (r.done) return r.value;
    const now = performance.now();
    if (now - last >= sliceMs) {
      await macrotask();
      throwIfAborted(signal);
      last = performance.now();
    }
  }
}
