/**
 * Home animation timeline (storyboard §1, §4; SPEC §10.1): every property is a pure function of
 * t mod 28 s, so the loop seam is exact and cycles cannot drift.
 */
import { describe, expect, it } from 'vitest';
import {
  BUILD,
  CAMERA_KEYS,
  CAPTIONS,
  CHAPTER_STARTS,
  LOOP,
  PLATES,
  POSTER_T,
  brickDropStart,
  brickLiftStart,
  cameraAt,
  captionIndexAt,
  figuresAt,
  keypadLed,
  layerDuration,
  plateSlideIn,
  plateSlideOut,
  projectionAt,
  projectorPower,
  roomLightsAt,
  screenModeAt,
  screenPower,
  wrap,
} from '../../src/home/timeline.ts';

const state = (t: number) => ({
  camera: cameraAt(t),
  projector: projectorPower(t),
  screen: screenPower(t),
  projection: projectionAt(t),
  screenMode: screenModeAt(t),
  figures: figuresAt(t),
  led: keypadLed(t),
  lights: roomLightsAt(t),
  caption: captionIndexAt(t),
});

function expectClose(a: unknown, b: unknown, path = ''): void {
  if (typeof a === 'number' && typeof b === 'number') {
    expect(Math.abs(a - b), path).toBeLessThan(1e-9);
  } else if (a && typeof a === 'object') {
    for (const k of Object.keys(a)) expectClose((a as never)[k], (b as never)[k], `${path}.${k}`);
  } else expect(a, path).toEqual(b);
}

describe('home timeline', () => {
  it('lasts 28 s (≤ 30 s, storyboard §1)', () => {
    expect(LOOP).toBe(28);
    expect(CAPTIONS.at(-1)!.end).toBe(LOOP);
  });

  it('is identical at t = 0, 28, 56 and 84 s (three cycles, no drift)', () => {
    const s0 = state(0);
    for (const k of [1, 2, 3]) expect(state(k * LOOP)).toEqual(s0);
    // and at arbitrary times of later cycles (t + k·28 is not exact in binary floating point:
    // compare within 1e-9, far below a frame)
    for (const t of [0.5, 3.7, 10.25, 19, 23.4, 27.9]) {
      for (const k of [1, 2, 3]) expectClose(state(t + k * LOOP), state(t));
    }
  });

  it('closes the camera path with continuous position and velocity at the seam', () => {
    const vec = (p: ReturnType<typeof cameraAt>) => [...p.target, p.az, p.el, p.dist];
    const at0 = vec(cameraAt(0));
    expect(at0).toEqual(vec({ ...CAMERA_KEYS[0]!.pose }));
    const h = 1e-3;
    const before = vec(cameraAt(LOOP - h));
    const after = vec(cameraAt(h));
    for (let k = 0; k < at0.length; k++) {
      // velocity is zero on both sides of every key (ease-in-out): position changes are O(h²)
      expect(Math.abs(before[k]! - at0[k]!)).toBeLessThan(1e-4);
      expect(Math.abs(after[k]! - at0[k]!)).toBeLessThan(1e-4);
    }
  });

  it('passes through every storyboard keyframe at its time (§2.1)', () => {
    for (const key of CAMERA_KEYS) {
      const p = cameraAt(key.t);
      expect(p.target[0]).toBeCloseTo(key.pose.target[0], 9);
      expect(p.az).toBeCloseTo(key.pose.az, 9);
      expect(p.dist).toBeCloseTo(key.pose.dist, 9);
    }
  });

  it('is at the dim, empty frame-0 state from 27.6 s to the seam (§4)', () => {
    for (const t of [27.6, 27.8, 27.99, 0, 1, 2.9]) {
      expect(projectorPower(t)).toBe(0);
      expect(screenPower(t)).toBe(0);
      expect(figuresAt(t).fade).toEqual([0, 0, 0]);
      expect(roomLightsAt(t)).toEqual({ hemi: 1.1, key: 2.4, glow: 0 });
    }
  });

  it('builds the model inside 4.0–10.5 s and takes it apart inside 24.5–26.9 s', () => {
    const maxLayer = 24;
    const L = layerDuration(maxLayer);
    expect(L).toBeCloseTo(0.25, 9);
    expect(brickDropStart(1, 0, maxLayer)).toBe(BUILD.start);
    const lastLanding = brickDropStart(maxLayer, 1, maxLayer) + BUILD.fall;
    expect(lastLanding).toBeLessThanOrEqual(10.5);
    // lift-off: top layer first, everything gone by 26.9 s
    expect(brickLiftStart(maxLayer, 1, maxLayer)).toBeCloseTo(24.5, 9);
    const lastGone = brickLiftStart(1, 0, maxLayer) + BUILD.liftDur;
    expect(lastGone).toBeLessThanOrEqual(26.9 + 1e-9);
    for (let k = 1; k < maxLayer; k++)
      expect(brickLiftStart(k + 1, 0.5, maxLayer)).toBeLessThan(brickLiftStart(k, 0.5, maxLayer));
  });

  it('slides the 15 plates in from 3.0 s and out by 27.6 s', () => {
    expect(plateSlideIn(0)).toBe(3);
    expect(plateSlideIn(14) + PLATES.inDur).toBeLessThan(4.3);
    expect(plateSlideOut(14, 15)).toBeCloseTo(27.0, 9);
    expect(plateSlideOut(0, 15) + PLATES.outDur).toBeCloseTo(27.6, 9);
  });

  it('switches captions at 0, 3, 11, 16, 23 s (storyboard §3) and chapters start there', () => {
    expect(CHAPTER_STARTS).toEqual([0, 3, 11, 16, 23]);
    expect([0, 2.99, 3, 10.99, 11, 15.99, 16, 22.99, 23, 27.99, 28].map(captionIndexAt)).toEqual([
      0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 0,
    ]);
  });

  it('shows the poster frame state at t = 19 s (storyboard §5)', () => {
    const p = projectionAt(POSTER_T);
    expect(projectorPower(POSTER_T)).toBe(1);
    expect(p.b).toBe('change-1');
    expect(p.mix).toBe(1);
    expect(screenModeAt(POSTER_T).mode).toBe('timeline');
    expect(figuresAt(POSTER_T).fade).toEqual([1, 1, 1]);
    expect(captionIndexAt(POSTER_T)).toBe(3);
  });

  it('never flashes: projector and screen fade over ≥ 0.4 s, the keypad LED pulses once per press', () => {
    const step = 1 / 120;
    let maxJump = 0;
    for (let t = 0; t < LOOP; t += step) {
      maxJump = Math.max(maxJump, Math.abs(projectorPower(t + step) - projectorPower(t)));
    }
    expect(maxJump).toBeLessThan(0.05); // 0.6 s fade sampled at 120 Hz
    let pulses = 0;
    let prev = 0;
    for (let t = 0; t < LOOP; t += step) {
      const v = keypadLed(t);
      if (v > 0.5 && prev <= 0.5) pulses++;
      prev = v;
    }
    expect(pulses).toBe(3);
  });

  it('wraps negative and large times', () => {
    expect(wrap(-1)).toBeCloseTo(27, 9);
    expect(wrap(28 * 1000 + 5)).toBeCloseTo(5, 6);
  });
});
