/** Progress callback: `fraction` in [0, 1] within the current `stage`. */
export type ProgressFn = (stage: string, fraction: number, detail?: string) => void;

export const noProgress: ProgressFn = () => {};

/** Maps the progress of a sub-task onto [from, to] of the parent stage. */
export function subProgress(
  progress: ProgressFn,
  stage: string,
  from: number,
  to: number,
): (f: number, detail?: string) => void {
  return (f, detail) => progress(stage, from + (to - from) * Math.min(1, Math.max(0, f)), detail);
}
