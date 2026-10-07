/**
 * Shader patches for the home animation. Everything moves on the GPU from one `uTime` uniform, so a
 * frame is a pure function of t (SPEC §6.2) and thousands of bricks cost one draw call.
 *
 * Instanced bricks, studs and baseplates carry `aAnim = (mode, t0, t1, unused)`:
 *  - mode 0, brick: falls from 2 brick heights from t0 (ease-out quint), lifts off from t1
 *    (rising 2 brick heights while fading);
 *  - mode 1, baseplate (and studs on empty plate cells): slides in along +x from t0, out from t1.
 * Fades use ordered-dither discard (no sorting, works in the shadow pass too).
 */
import type * as THREE from 'three';

export interface AnimUniforms {
  uTime: { value: number };
  uFall: { value: number };
  uDropDur: { value: number };
  uLiftDur: { value: number };
  uSlideIn: { value: number };
  uSlideOut: { value: number };
  uTravel: { value: number };
}

const DITHER = /* glsl */ `
float lzDither(vec2 p) { return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715)))); }
`;

const ANIM_VERTEX_DECL = /* glsl */ `
attribute vec4 aAnim;
uniform float uTime, uFall, uDropDur, uLiftDur, uSlideIn, uSlideOut, uTravel;
varying float vLzVis;
`;

const ANIM_VERTEX_BODY = /* glsl */ `
{
  vec3 lzOff = vec3(0.0);
  float lzVis = 1.0;
  if (aAnim.x < 0.5) {
    float pd = clamp((uTime - aAnim.y) / uDropDur, 0.0, 1.0);
    float pl = clamp((uTime - aAnim.z) / uLiftDur, 0.0, 1.0);
    float fall = 1.0 - pow(1.0 - pd, 5.0);
    lzOff.z = (1.0 - fall) * uFall + pl * pl * uFall;
    lzVis = smoothstep(0.0, 0.3, pd) * (1.0 - pl);
    if (uTime < aAnim.y || uTime >= aAnim.z + uLiftDur) lzVis = 0.0;
  } else {
    float pi = clamp((uTime - aAnim.y) / uSlideIn, 0.0, 1.0);
    float po = clamp((uTime - aAnim.z) / uSlideOut, 0.0, 1.0);
    float ein = 1.0 - pow(1.0 - pi, 3.0);
    lzOff.x = (1.0 - ein) * uTravel + po * po * po * uTravel;
    lzVis = smoothstep(0.0, 0.5, pi) * (1.0 - smoothstep(0.4, 1.0, po));
    if (uTime < aAnim.y || uTime >= aAnim.z + uSlideOut) lzVis = 0.0;
  }
  vLzVis = lzVis;
  #ifdef USE_INSTANCING
    vec3 lzScale = vec3(length(instanceMatrix[0].xyz), length(instanceMatrix[1].xyz), length(instanceMatrix[2].xyz));
  #else
    vec3 lzScale = vec3(1.0);
  #endif
  if (lzVis <= 0.002) transformed = vec3(0.0);
  transformed += lzOff / lzScale;
}
`;

const VIS_FRAGMENT_DECL = /* glsl */ `
varying float vLzVis;
${DITHER}
`;
const VIS_FRAGMENT_BODY = /* glsl */ `
  if (vLzVis < 0.999 && lzDither(gl_FragCoord.xy) >= vLzVis) discard;
`;

function patchMain(src: string, body: string): string {
  return src.replace('void main() {', `void main() {\n${body}`);
}

/** Patch a material (standard or depth) for animated instances. */
export function animateInstances<T extends THREE.Material>(
  material: T,
  uniforms: AnimUniforms,
  cacheKey: string,
): T {
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = (ANIM_VERTEX_DECL + shader.vertexShader).replace(
      '#include <begin_vertex>',
      `#include <begin_vertex>\n${ANIM_VERTEX_BODY}`,
    );
    shader.fragmentShader = patchMain(VIS_FRAGMENT_DECL + shader.fragmentShader, VIS_FRAGMENT_BODY);
  };
  material.customProgramCacheKey = () => `lz-anim-${cacheKey}`;
  return material;
}

/** Patch a material so a whole object fades with dithering from `uFade` (figures, keypad). */
export function fadeWithUniform<T extends THREE.Material>(
  material: T,
  uFade: { value: number },
  cacheKey: string,
): T {
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uFade = uFade;
    shader.fragmentShader = patchMain(
      `uniform float uFade;\n${DITHER}\n` + shader.fragmentShader,
      `  if (uFade < 0.999 && lzDither(gl_FragCoord.xy) >= uFade) discard;\n`,
    );
  };
  material.customProgramCacheKey = () => `lz-fade-${cacheKey}`;
  return material;
}

export function makeAnimUniforms(): AnimUniforms {
  return {
    uTime: { value: 0 },
    uFall: { value: 0 },
    uDropDur: { value: 0.3 },
    uLiftDur: { value: 0.35 },
    uSlideIn: { value: 0.4 },
    uSlideOut: { value: 0.32 },
    uTravel: { value: 0.55 },
  };
}
