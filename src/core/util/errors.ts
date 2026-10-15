/** Error codes the UI maps to localized messages (SPEC I11). */
export type EngineErrorCode =
  | 'unsupported-format'
  | 'unsupported-feature'
  | 'invalid-file'
  | 'empty-geometry'
  | 'no-features'
  | 'too-large'
  | 'missing-files'
  | 'empty-selection'
  | 'invalid-params'
  | 'cancelled';

export class EngineError extends Error {
  readonly code: EngineErrorCode;
  readonly details: Record<string, unknown> | undefined;
  constructor(code: EngineErrorCode, message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = 'EngineError';
    this.code = code;
    this.details = details;
  }
}

export function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw new EngineError('cancelled', 'Operation cancelled');
}
