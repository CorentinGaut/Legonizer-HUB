/** Browser helper: starts the engine Worker (module worker, bundled by Vite) and wraps it. */
import { EngineClient } from './client.ts';

export function createEngineClient(): EngineClient {
  return new EngineClient(
    new Worker(new URL('./engine.worker.ts', import.meta.url), { type: 'module', name: 'legonizer-engine' }),
  );
}
