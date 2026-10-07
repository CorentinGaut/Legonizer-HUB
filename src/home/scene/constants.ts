/**
 * Dimensions and colours of the home scene (SPEC §2, H3).
 * World frame: origin = centre of the table top, x along the 2 m length (viewers' left → right),
 * y across (front → mast), z up; metres.
 */
export const PITCH = 0.008; // stud pitch
export const BRICK_H = 0.0096;
export const STUD_R = 0.0024;
export const STUD_H = 0.0017;
export const PLATE_T = 0.0018;
export const GAP = 0.00025; // between bricks (far views)

/** South-west corner of the 5 × 3 plate model: x −0.92 … +0.36, y −0.384 … +0.384. */
export const MODEL_X0 = -0.92;
export const MODEL_Y0 = -0.384;

export const TABLE = { length: 2.0, width: 1.0, top: 0, floor: -0.6 };
/** Projector lens and the spot frustum: square-pixel 2 : 1 map over the table. */
export const LENS = { x: 0, y: 0, z: 1.615 };
export const SPOT = { angleDeg: 35, focus: 0.5, aspect: 2 };
/** Half extents of the projected map on the table plane (z = 0). */
export const MAP_HALF_Y = LENS.z * Math.tan(((SPOT.angleDeg * Math.PI) / 180) * SPOT.focus);
export const MAP_HALF_X = LENS.z * SPOT.aspect * Math.tan(((SPOT.angleDeg * Math.PI) / 180) * SPOT.focus);
/** Media strip next to the model (projected, SPEC §2). */
export const MEDIA = { x0: 0.42, x1: 0.96, y0: -0.4, y1: 0.4 };

export const COLORS = {
  background: '#0d0e11',
  brick: '#f4f2ec',
  baseplate: '#a9abaf',
  table: '#efeee9',
  tableLegs: '#cfcdc7',
  metal: '#1c1d20',
  projector: '#e9e8e4',
  lensOn: '#fff3dc',
  lensOff: '#22242a',
  bezel: '#111215',
  floor: '#2f2d2a',
  wall: '#24252a',
  keypad: '#1c1d20',
  led: '#a3abff',
  cone: '#fff4e2',
  // projected data (--lz-proj-* in src/styles/tokens.css; change colours: SPEC §12)
  built: '#14b391',
  demolished: '#b42330',
  modified: '#fbe04b',
  housing: '#ffc37a',
  offices: '#4e4bb0',
  shops: '#ec4f91',
  public: '#38bbd6',
  industry: '#6e675d',
  vegetation: '#528c39',
  transport: '#1b1c20',
  transportCasing: '#ffffff',
  projGround: '#e9e7e1',
  mediaPanel: '#f4f3ef',
  // screen
  screenBg: '#10131a',
  screenGround: '#3a3f4a',
  screenRing: '#5b6070',
  screenDot: '#c9ccd6',
  screenFocus: '#a3abff',
} as const;
