/**
 * Home animation timeline (SPEC §6.2).
 *
 * Every animated property is a pure function of `t = clock mod LOOP` (SPEC §6.2): no physics,
 * no accumulated dt, so the loop is exact and any frame can be rendered on its own (poster, tests).
 * This module has no three.js dependency; it is shared by the hero controller (captions, chapters)
 * and the lazily loaded 3D scene.
 */

export const LOOP = 28.0;
/** Poster frame (SPEC H10): change layer, media card, figures, timeline on the screen. */
export const POSTER_T = 19.0;

export type CaptionId = 'c1' | 'c2' | 'c3' | 'c4' | 'c5';
export const CAPTIONS: readonly { id: CaptionId; start: number; end: number }[] = [
  { id: 'c1', start: 0, end: 3 },
  { id: 'c2', start: 3, end: 11 },
  { id: 'c3', start: 11, end: 16 },
  { id: 'c4', start: 16, end: 23 },
  { id: 'c5', start: 23, end: 28 },
];
/** Chapter starts (0, 3, 11, 16, 23 s). */
export const CHAPTER_STARTS = CAPTIONS.map((c) => c.start);

/** Wrap any time into [0, LOOP). */
export function wrap(t: number): number {
  const r = t % LOOP;
  return r < 0 ? r + LOOP : r;
}

export function captionIndexAt(t: number): number {
  const u = wrap(t);
  for (let i = CAPTIONS.length - 1; i >= 0; i--) if (u >= CAPTIONS[i]!.start) return i;
  return 0;
}

// ------------------------------------------------------------------------------------- easing

export const clamp01 = (x: number): number => (x < 0 ? 0 : x > 1 ? 1 : x);
/** Linear ramp from 0 at a to 1 at b. */
export const ramp = (t: number, a: number, b: number): number => clamp01((t - a) / (b - a));
export const smooth = (x: number): number => {
  const u = clamp01(x);
  return u * u * (3 - 2 * u);
};
export const easeInOutCubic = (x: number): number => {
  const u = clamp01(x);
  return u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2;
};
export const easeOutCubic = (x: number): number => 1 - Math.pow(1 - clamp01(x), 3);
export const easeInCubic = (x: number): number => Math.pow(clamp01(x), 3);
/** --lz-ease-brick ≈ ease-out quint. */
export const easeOutQuint = (x: number): number => 1 - Math.pow(1 - clamp01(x), 5);

// ------------------------------------------------------------------------------------- camera

export interface CameraPose {
  /** Look-at point in the table frame, metres. */
  target: [number, number, number];
  /** Degrees from the front (−y), positive toward +x. */
  az: number;
  /** Degrees above horizontal. */
  el: number;
  /** Metres from the target. */
  dist: number;
}

/** Camera keyframes and their times; the path is closed (K0 again at 28 s ≡ 0 s). */
export const CAMERA_KEYS: readonly { t: number; pose: CameraPose }[] = [
  { t: 0, pose: { target: [0, 0, 0.55], az: -25, el: 18, dist: 4.6 } }, // K0
  { t: 4, pose: { target: [-0.2, 0, 0.1], az: -15, el: 30, dist: 3.0 } }, // K1
  { t: 13.5, pose: { target: [-0.2, 0, 0.0], az: -5, el: 48, dist: 2.8 } }, // K2
  // K3/K3b: elevation and distance of the designed poster frame (27°, 4.3 m), a little
  // further so the three figures stay out of the desktop text-safe zone
  { t: 17.5, pose: { target: [0.1, 0, 0.5], az: 15, el: 26, dist: 4.8 } }, // K3
  { t: 23, pose: { target: [0.1, 0, 0.5], az: 20, el: 26, dist: 4.8 } }, // K3b
];

const poseVec = (p: CameraPose): number[] => [...p.target, p.az, p.el, p.dist];

function catmullRom(p0: number, p1: number, p2: number, p3: number, u: number): number {
  const u2 = u * u;
  const u3 = u2 * u;
  return (
    0.5 * (2 * p1 + (-p0 + p2) * u + (2 * p0 - 5 * p1 + 4 * p2 - p3) * u2 + (-p0 + 3 * p1 - 3 * p2 + p3) * u3)
  );
}

/**
 * Camera pose at time t: closed Catmull-Rom spline through K0 → K1 → K2 → K3 → K3b → K0 on
 * (target, azimuth, elevation, distance), ease-in-out timing per segment. Position and velocity are
 * continuous across the seam (the velocity is zero at every key, including 0 ≡ 28 s).
 */
export function cameraAt(t: number): CameraPose {
  const u = wrap(t);
  const n = CAMERA_KEYS.length;
  let i = n - 1;
  for (let k = 0; k < n; k++) {
    const next = k + 1 < n ? CAMERA_KEYS[k + 1]!.t : LOOP;
    if (u >= CAMERA_KEYS[k]!.t && u < next) {
      i = k;
      break;
    }
  }
  const t0 = CAMERA_KEYS[i]!.t;
  const t1 = i + 1 < n ? CAMERA_KEYS[i + 1]!.t : LOOP;
  const s = easeInOutCubic((u - t0) / (t1 - t0));
  const P = (k: number) => poseVec(CAMERA_KEYS[((k % n) + n) % n]!.pose);
  const a = P(i - 1),
    b = P(i),
    c = P(i + 1),
    d = P(i + 2);
  const v = b.map((_, k) => catmullRom(a[k]!, b[k]!, c[k]!, d[k]!, s));
  return { target: [v[0]!, v[1]!, v[2]!], az: v[3]!, el: v[4]!, dist: v[5]! };
}

// ------------------------------------------------------------------------------------- build

/** Brick build (SPEC §6.2, scene 1): 4.0–10.5 s, layer by layer, west→east wave inside a layer. */
export const BUILD = {
  start: 4.0,
  span: 6.0,
  minLayer: 0.25,
  waveShare: 0.6,
  fall: 0.3,
  liftStart: 24.5,
  liftSpan: 2.4,
  liftDur: 0.35,
};

export function layerDuration(maxLayer: number): number {
  return Math.max(BUILD.minLayer, BUILD.span / Math.max(1, maxLayer));
}

/** When a brick starts falling. `xFrac` = west→east position of its centre in [0, 1]. */
export function brickDropStart(layer: number, xFrac: number, maxLayer: number): number {
  const L = layerDuration(maxLayer);
  return BUILD.start + (layer - 1) * L + BUILD.waveShare * L * clamp01(xFrac);
}

/** When a brick starts lifting off (end of the loop, SPEC §6.2): top layer first, east→west, 2.4 s in total. */
export function brickLiftStart(layer: number, xFrac: number, maxLayer: number): number {
  const steps = Math.max(1, maxLayer) - 1 + BUILD.waveShare;
  const Lr = (BUILD.liftSpan - BUILD.liftDur) / steps;
  return BUILD.liftStart + (maxLayer - layer) * Lr + BUILD.waveShare * Lr * (1 - clamp01(xFrac));
}

/** Baseplates: slide in from the media strip side 3.0–4.3 s (A1, B1… order), out 27.0–27.6 s. */
export const PLATES = {
  inStart: 3.0,
  inStagger: 0.06,
  inDur: 0.4,
  outStart: 27.0,
  outSpan: 0.6,
  outDur: 0.32,
  travel: 0.55,
};

export function plateSlideIn(order: number): number {
  return PLATES.inStart + order * PLATES.inStagger;
}
export function plateSlideOut(order: number, count: number): number {
  const stagger = count > 1 ? (PLATES.outSpan - PLATES.outDur) / (count - 1) : 0;
  return PLATES.outStart + (count - 1 - order) * stagger;
}

// ------------------------------------------------------------------------------------- devices

/** Projector power 0…1: on 11.0–11.6 (fade, no flash), off 24.0–24.5. */
export function projectorPower(t: number): number {
  const u = wrap(t);
  return smooth(ramp(u, 11.0, 11.6)) * (1 - smooth(ramp(u, 24.0, 24.5)));
}

/** Screen power 0…1: on 3.0–3.4, dims 24.0–24.5. */
export function screenPower(t: number): number {
  const u = wrap(t);
  return smooth(ramp(u, 3.0, 3.4)) * (1 - smooth(ramp(u, 24.0, 24.5)));
}

export type LayerKey = 'plain' | 'functions' | 'functions-green' | 'functions-tram' | 'change-1' | 'change-2';

/** What the projector shows: crossfade from `a` to `b` by `mix`; `tram` = tram line progress 0…1. */
export interface ProjectionState {
  a: LayerKey;
  b: LayerKey;
  mix: number;
  tram: number;
}

export function projectionAt(t: number): ProjectionState {
  const u = wrap(t);
  const tram = smooth(ramp(u, 13.2, 14.7));
  const x = (a: LayerKey, b: LayerKey, t0: number, t1: number): ProjectionState => ({
    a,
    b,
    mix: smooth(ramp(u, t0, t1)),
    tram,
  });
  if (u < 11.6) return { a: 'plain', b: 'plain', mix: 0, tram: 0 };
  if (u < 12.6) return x('plain', 'functions', 11.6, 12.4);
  if (u < 13.2) return x('functions', 'functions-green', 12.6, 13.0);
  if (u < 17.0) return { a: 'functions-tram', b: 'functions-tram', mix: 0, tram };
  if (u < 20.8) return x('functions-tram', 'change-1', 17.0, 17.5);
  if (u < 23.0) return x('change-1', 'change-2', 20.8, 21.2);
  return x('change-2', 'plain', 23.0, 23.5);
}

/** Keypad presses (LED pulses once each; WCAG 2.3.1: no flashing). */
export const KEYPAD_PRESSES = [17.0, 20.8, 23.0];

export function keypadLed(t: number): number {
  const u = wrap(t);
  let v = 0;
  for (const p of KEYPAD_PRESSES) {
    const d = u - p;
    if (d >= 0 && d < 0.45) v = Math.max(v, Math.sin((d / 0.45) * Math.PI));
  }
  return v;
}

/** Screen content: 'city' (source model, slow pan) until 16 s, then 'timeline'. */
export function screenModeAt(t: number): {
  mode: 'city' | 'timeline';
  change: number;
  focus: number;
  pan: number;
} {
  const u = wrap(t);
  // focus position on the circular timeline (versions 0…6): 3 → 4 at 17.0, → 5 at 20.8
  const focus = 3 + smooth(ramp(u, 17.0, 17.5)) + smooth(ramp(u, 20.8, 21.2));
  return {
    mode: u >= 16.0 && u < 24.5 ? 'timeline' : 'city',
    change: smooth(ramp(u, 17.0, 17.5)) * (1 - smooth(ramp(u, 23.0, 23.5))),
    focus,
    pan: u,
  };
}

// ------------------------------------------------------------------------------------- figures

export interface FiguresState {
  /** Visibility per figure (adult with keypad, child, adult by the media strip). */
  fade: [number, number, number];
  /** 0…1 turn toward the model (17–18 s). */
  turn: number;
  /** 0…1 pointing gesture of the right-hand adult. */
  point: number;
  /** 0…1 keypad handover (adult → child) 20.0–20.8 s. */
  handover: number;
  /** 0…1 child's arm raised to press the keypad after the handover. */
  childPress: number;
}

export function figuresAt(t: number): FiguresState {
  const u = wrap(t);
  const out = 1 - smooth(ramp(u, 23.5, 24.0));
  const f = (s: number) => smooth(ramp(u, s, s + 0.6)) * out;
  return {
    fade: [f(16.0), f(16.2), f(16.4)],
    turn: smooth(ramp(u, 17.0, 18.0)) * out,
    point: smooth(ramp(u, 17.6, 18.4)) * (1 - smooth(ramp(u, 21.6, 22.6))),
    handover: smooth(ramp(u, 20.0, 20.8)),
    childPress: smooth(ramp(u, 20.6, 21.0)) * (1 - smooth(ramp(u, 22.2, 22.8))),
  };
}

/** Room lights: interpolate the off and on states with the projector power. */
export function roomLightsAt(t: number): { hemi: number; key: number; glow: number } {
  const p = projectorPower(t);
  return { hemi: 1.1 + (0.9 - 1.1) * p, key: 2.4 + (1.9 - 2.4) * p, glow: 0.6 * screenPower(t) };
}
