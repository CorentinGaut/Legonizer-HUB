/**
 * Minimal stroke font for plate labels (A1, B12, …) drawn into DOM-free rasters (calque PNG/JPEG).
 * Glyphs are polylines on a 4 × 6 grid (y down); advance 5 units. Only what plate names and small
 * numbers need: A–Z, 0–9 and a few signs.
 */
type Poly = [number, number][];

const OCT: Poly = [
  [1, 0],
  [3, 0],
  [4, 1],
  [4, 5],
  [3, 6],
  [1, 6],
  [0, 5],
  [0, 1],
  [1, 0],
];

export const STROKE_GLYPHS: Record<string, Poly[]> = {
  '0': [
    OCT,
    [
      [0.6, 5.2],
      [3.4, 0.8],
    ],
  ],
  '1': [
    [
      [1, 1],
      [2, 0],
      [2, 6],
    ],
    [
      [1, 6],
      [3, 6],
    ],
  ],
  '2': [
    [
      [0, 1],
      [1, 0],
      [3, 0],
      [4, 1],
      [4, 2],
      [0, 6],
      [4, 6],
    ],
  ],
  '3': [
    [
      [0, 0],
      [4, 0],
      [2, 2.5],
      [3, 2.5],
      [4, 3.5],
      [4, 5],
      [3, 6],
      [1, 6],
      [0, 5],
    ],
  ],
  '4': [
    [
      [3, 6],
      [3, 0],
      [0, 4],
      [4, 4],
    ],
  ],
  '5': [
    [
      [4, 0],
      [0, 0],
      [0, 2.5],
      [3, 2.5],
      [4, 3.5],
      [4, 5],
      [3, 6],
      [0, 6],
    ],
  ],
  '6': [
    [
      [3, 0],
      [1, 0],
      [0, 1],
      [0, 5],
      [1, 6],
      [3, 6],
      [4, 5],
      [4, 3.5],
      [3, 2.5],
      [0, 2.5],
    ],
  ],
  '7': [
    [
      [0, 0],
      [4, 0],
      [1.5, 6],
    ],
  ],
  '8': [
    [
      [1, 0],
      [3, 0],
      [4, 1],
      [4, 2],
      [3, 3],
      [1, 3],
      [0, 2],
      [0, 1],
      [1, 0],
    ],
    [
      [1, 3],
      [0, 4],
      [0, 5],
      [1, 6],
      [3, 6],
      [4, 5],
      [4, 4],
      [3, 3],
    ],
  ],
  '9': [
    [
      [4, 3.5],
      [1, 3.5],
      [0, 2.5],
      [0, 1],
      [1, 0],
      [3, 0],
      [4, 1],
      [4, 5],
      [3, 6],
      [1, 6],
    ],
  ],
  A: [
    [
      [0, 6],
      [0, 2],
      [2, 0],
      [4, 2],
      [4, 6],
    ],
    [
      [0, 3.5],
      [4, 3.5],
    ],
  ],
  B: [
    [
      [0, 0],
      [0, 6],
      [3, 6],
      [4, 5],
      [4, 4],
      [3, 3],
      [0, 3],
    ],
    [
      [0, 0],
      [3, 0],
      [4, 1],
      [4, 2],
      [3, 3],
    ],
  ],
  C: [
    [
      [4, 1],
      [3, 0],
      [1, 0],
      [0, 1],
      [0, 5],
      [1, 6],
      [3, 6],
      [4, 5],
    ],
  ],
  D: [
    [
      [0, 0],
      [0, 6],
      [2.5, 6],
      [4, 4.5],
      [4, 1.5],
      [2.5, 0],
      [0, 0],
    ],
  ],
  E: [
    [
      [4, 0],
      [0, 0],
      [0, 6],
      [4, 6],
    ],
    [
      [0, 3],
      [3, 3],
    ],
  ],
  F: [
    [
      [4, 0],
      [0, 0],
      [0, 6],
    ],
    [
      [0, 3],
      [3, 3],
    ],
  ],
  G: [
    [
      [4, 1],
      [3, 0],
      [1, 0],
      [0, 1],
      [0, 5],
      [1, 6],
      [3, 6],
      [4, 5],
      [4, 3.5],
      [2, 3.5],
    ],
  ],
  H: [
    [
      [0, 0],
      [0, 6],
    ],
    [
      [4, 0],
      [4, 6],
    ],
    [
      [0, 3],
      [4, 3],
    ],
  ],
  I: [
    [
      [1, 0],
      [3, 0],
    ],
    [
      [2, 0],
      [2, 6],
    ],
    [
      [1, 6],
      [3, 6],
    ],
  ],
  J: [
    [
      [4, 0],
      [4, 5],
      [3, 6],
      [1, 6],
      [0, 5],
    ],
  ],
  K: [
    [
      [0, 0],
      [0, 6],
    ],
    [
      [4, 0],
      [0, 3.5],
    ],
    [
      [1.3, 2.7],
      [4, 6],
    ],
  ],
  L: [
    [
      [0, 0],
      [0, 6],
      [4, 6],
    ],
  ],
  M: [
    [
      [0, 6],
      [0, 0],
      [2, 3],
      [4, 0],
      [4, 6],
    ],
  ],
  N: [
    [
      [0, 6],
      [0, 0],
      [4, 6],
      [4, 0],
    ],
  ],
  O: [OCT],
  P: [
    [
      [0, 6],
      [0, 0],
      [3, 0],
      [4, 1],
      [4, 2],
      [3, 3],
      [0, 3],
    ],
  ],
  Q: [
    OCT,
    [
      [2.5, 4.5],
      [4, 6],
    ],
  ],
  R: [
    [
      [0, 6],
      [0, 0],
      [3, 0],
      [4, 1],
      [4, 2],
      [3, 3],
      [0, 3],
    ],
    [
      [2, 3],
      [4, 6],
    ],
  ],
  S: [
    [
      [4, 1],
      [3, 0],
      [1, 0],
      [0, 1],
      [0, 2],
      [1, 3],
      [3, 3],
      [4, 4],
      [4, 5],
      [3, 6],
      [1, 6],
      [0, 5],
    ],
  ],
  T: [
    [
      [0, 0],
      [4, 0],
    ],
    [
      [2, 0],
      [2, 6],
    ],
  ],
  U: [
    [
      [0, 0],
      [0, 5],
      [1, 6],
      [3, 6],
      [4, 5],
      [4, 0],
    ],
  ],
  V: [
    [
      [0, 0],
      [2, 6],
      [4, 0],
    ],
  ],
  W: [
    [
      [0, 0],
      [1, 6],
      [2, 3],
      [3, 6],
      [4, 0],
    ],
  ],
  X: [
    [
      [0, 0],
      [4, 6],
    ],
    [
      [4, 0],
      [0, 6],
    ],
  ],
  Y: [
    [
      [0, 0],
      [2, 3],
      [4, 0],
    ],
    [
      [2, 3],
      [2, 6],
    ],
  ],
  Z: [
    [
      [0, 0],
      [4, 0],
      [0, 6],
      [4, 6],
    ],
  ],
  '-': [
    [
      [0.5, 3],
      [3.5, 3],
    ],
  ],
  '.': [
    [
      [1.8, 5.8],
      [2.2, 5.8],
    ],
  ],
  ' ': [],
};

export const STROKE_ADVANCE = 5;
export const STROKE_HEIGHT = 6;

/** Segments of `text` in font units, origin at the top-left of the first glyph. */
export function strokeTextSegments(text: string): [number, number, number, number][] {
  const out: [number, number, number, number][] = [];
  let x0 = 0;
  for (const ch of text.toUpperCase()) {
    for (const poly of STROKE_GLYPHS[ch] ?? []) {
      for (let k = 1; k < poly.length; k++) {
        const a = poly[k - 1]!,
          b = poly[k]!;
        out.push([x0 + a[0], a[1], x0 + b[0], b[1]]);
      }
    }
    x0 += STROKE_ADVANCE;
  }
  return out;
}

export function strokeTextWidth(text: string): number {
  return text.length ? text.length * STROKE_ADVANCE - 1 : 0;
}

/**
 * Draws text into an RGBA raster with anti-aliased round-capped strokes. `size` = cap height in px,
 * (x, y) = top-left corner. An optional halo (wider stroke drawn first) keeps labels readable.
 */
export function drawStrokeText(
  img: Uint8ClampedArray | Uint8Array,
  width: number,
  height: number,
  text: string,
  x: number,
  y: number,
  size: number,
  colour: [number, number, number],
  opts: { strokeWidth?: number; halo?: [number, number, number]; haloWidth?: number } = {},
): void {
  const k = size / STROKE_HEIGHT;
  const segs = strokeTextSegments(text).map(
    ([a, b, c, d]) => [x + a * k, y + b * k, x + c * k, y + d * k] as [number, number, number, number],
  );
  const sw = opts.strokeWidth ?? Math.max(1, size / 7);
  if (opts.halo) paintSegments(img, width, height, segs, sw / 2 + (opts.haloWidth ?? sw), opts.halo);
  paintSegments(img, width, height, segs, sw / 2, colour);
}

function paintSegments(
  img: Uint8ClampedArray | Uint8Array,
  W: number,
  H: number,
  segs: [number, number, number, number][],
  half: number,
  colour: [number, number, number],
): void {
  if (!segs.length) return;
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;
  for (const [a, b, c, d] of segs) {
    minX = Math.min(minX, a, c);
    maxX = Math.max(maxX, a, c);
    minY = Math.min(minY, b, d);
    maxY = Math.max(maxY, b, d);
  }
  const x0 = Math.max(0, Math.floor(minX - half - 1)),
    x1 = Math.min(W - 1, Math.ceil(maxX + half + 1));
  const y0 = Math.max(0, Math.floor(minY - half - 1)),
    y1 = Math.min(H - 1, Math.ceil(maxY + half + 1));
  for (let py = y0; py <= y1; py++) {
    for (let px = x0; px <= x1; px++) {
      const cx = px + 0.5,
        cy = py + 0.5;
      let dmin = Infinity;
      for (const [ax, ay, bx, by] of segs) {
        const vx = bx - ax,
          vy = by - ay;
        const l2 = vx * vx + vy * vy;
        const t = l2 > 0 ? Math.min(1, Math.max(0, ((cx - ax) * vx + (cy - ay) * vy) / l2)) : 0;
        const dx = cx - (ax + t * vx),
          dy = cy - (ay + t * vy);
        const dd = dx * dx + dy * dy;
        if (dd < dmin) dmin = dd;
      }
      const a = Math.min(1, Math.max(0, half + 0.5 - Math.sqrt(dmin)));
      if (a <= 0) continue;
      const o = (py * W + px) * 4;
      for (let c = 0; c < 3; c++) img[o + c] = Math.round(img[o + c]! * (1 - a) + colour[c]! * a);
    }
  }
}
