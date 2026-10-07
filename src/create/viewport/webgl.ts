/** WebGL 2 detection (SPEC N2). `?webgl=0` forces the 2D mode (tests, support). */
let cached: boolean | null = null;

export function hasWebGL2(): boolean {
  if (cached !== null) return cached;
  try {
    if (new URLSearchParams(location.search).get('webgl') === '0') return (cached = false);
    const c = document.createElement('canvas');
    const gl = c.getContext('webgl2');
    cached = !!gl;
    (gl?.getExtension('WEBGL_lose_context') as { loseContext?: () => void } | null)?.loseContext?.();
  } catch {
    cached = false;
  }
  return cached;
}
