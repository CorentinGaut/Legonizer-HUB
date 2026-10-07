/**
 * Persistence in this browser (SPEC §7: the state survives a reload; every change is saved within 1 s):
 * the project state and, when they fit, the input files so a reload can re-import the model.
 * Demos are not stored (they are fetched again from the site).
 */
import type { WireFile } from '../core/worker/protocol.ts';
import type { ProjectState } from './state.ts';

const DB = 'legonizer-create';
const STORE = 'kv';
/** Keep input files up to this total size (larger models must be added again after a reload). */
export const MAX_STORED_BYTES = 250 * 1024 * 1024;

let dbPromise: Promise<IDBDatabase> | null = null;

function db(): Promise<IDBDatabase> {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      if (typeof indexedDB === 'undefined') return reject(new Error('IndexedDB unavailable'));
      const req = indexedDB.open(DB, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
      req.onblocked = () => reject(new Error('IndexedDB blocked'));
    });
    dbPromise.catch(() => (dbPromise = null));
  }
  return dbPromise;
}

function tx<T>(
  mode: IDBTransactionMode,
  run: (s: IDBObjectStore) => IDBRequest<T> | void,
): Promise<T | undefined> {
  return db().then(
    (d) =>
      new Promise<T | undefined>((resolve, reject) => {
        const t = d.transaction(STORE, mode);
        const s = t.objectStore(STORE);
        const req = run(s);
        t.oncomplete = () => resolve(req ? req.result : undefined);
        t.onerror = () => reject(t.error);
        t.onabort = () => reject(t.error ?? new Error('aborted'));
      }),
  );
}

export async function saveProject(p: ProjectState): Promise<void> {
  // structured clone keeps typed arrays (heights) compact
  await tx('readwrite', (s) => s.put(p, 'project'));
}

export async function loadProject(): Promise<ProjectState | null> {
  try {
    const p = (await tx<ProjectState>('readonly', (s) => s.get('project'))) ?? null;
    return p && p.version === 1 ? p : null;
  } catch {
    return null;
  }
}

export async function saveFiles(files: WireFile[]): Promise<boolean> {
  const total = files.reduce((a, f) => a + f.data.length, 0);
  if (total > MAX_STORED_BYTES) {
    await clearFiles();
    return false;
  }
  try {
    await tx('readwrite', (s) => s.put(files, 'files'));
    return true;
  } catch {
    return false;
  }
}

export async function loadFiles(): Promise<WireFile[] | null> {
  try {
    return (await tx<WireFile[]>('readonly', (s) => s.get('files'))) ?? null;
  } catch {
    return null;
  }
}

export async function clearFiles(): Promise<void> {
  try {
    await tx('readwrite', (s) => s.delete('files'));
  } catch {
    // ignore
  }
}

export async function clearAll(): Promise<void> {
  try {
    await tx('readwrite', (s) => s.clear());
  } catch {
    // ignore
  }
}

export function isQuotaError(e: unknown): boolean {
  return (
    e instanceof DOMException && (e.name === 'QuotaExceededError' || e.name === 'NS_ERROR_DOM_QUOTA_REACHED')
  );
}
