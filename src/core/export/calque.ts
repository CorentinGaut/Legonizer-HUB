/**
 * Projection layer — "calque" (SPEC §3.1 step 5, O2).
 *
 * Legacy (UD-Viz `generateCadastre`): orthographic top view, white background, every non-zero cell
 * drawn as a box wireframe (three's WireframeGeometry: the square plus its diagonal seen from above)
 * in black at 25 % opacity, image long side 1920 px (px per plate = 1920 / max(platesX, platesY)),
 * east right, north up, saved as `calqueTemplate.jpg`.
 *
 * DOM-free: layout, RGBA rasterizers (legacy look and modern outline), plate grid and labels (stroke
 * font), a PNG encoder with a pHYs chunk (physical size, PNG spec §11.3.5.3
 * https://www.w3.org/TR/png-3/#11pHYs) and a baseline JPEG encoder (jpeg.ts).
 */
import { zlibSync } from 'fflate';
import { encodeJpeg } from './jpeg.ts';
import { STUDS_PER_PLATE, type HeightMap } from '../types.ts';
import { STUD_PITCH_MM } from '../heightmap/area.ts';
import { plateName } from '../packing/plates.ts';
import { drawStrokeText } from './strokeFont.ts';

export const LEGACY_CALQUE_NAME = 'calqueTemplate.jpg';
export const LEGACY_CALQUE_LONG_SIDE = 1920;

export interface CalqueLayout {
  width: number;
  height: number;
  /** Pixels per stud. */
  cell: number;
  /** Dots per inch when the image is printed at the model's physical size. */
  dpi: number;
  plates: { name: string; x: number; y: number; w: number; h: number }[];
}

/** Legacy size: long side 1920 px (three's setSize floors the canvas size). */
export function legacyCalqueLayout(hm: HeightMap): CalqueLayout {
  const px = hm.cols / STUDS_PER_PLATE,
    py = hm.rows / STUDS_PER_PLATE;
  const perPlate = LEGACY_CALQUE_LONG_SIDE / (hm.cols > hm.rows ? px : py);
  return layout(hm, perPlate / STUDS_PER_PLATE);
}

/** Physical-size layout: `dpi` dots per inch at 8 mm per stud. */
export function physicalCalqueLayout(hm: HeightMap, dpi: number): CalqueLayout {
  return layout(hm, (dpi * STUD_PITCH_MM) / 25.4);
}

function layout(hm: HeightMap, cell: number): CalqueLayout {
  const px = hm.cols / STUDS_PER_PLATE,
    py = hm.rows / STUDS_PER_PLATE;
  const plates: CalqueLayout['plates'] = [];
  for (let row = py - 1; row >= 0; row--) {
    for (let col = 0; col < px; col++) {
      const top = (py - 1 - row) * STUDS_PER_PLATE * cell;
      plates.push({
        name: plateName(col, row, py),
        x: col * STUDS_PER_PLATE * cell,
        y: top,
        w: STUDS_PER_PLATE * cell,
        h: STUDS_PER_PLATE * cell,
      });
    }
  }
  return {
    width: Math.floor(hm.cols * cell),
    height: Math.floor(hm.rows * cell),
    cell,
    dpi: (cell * 25.4) / STUD_PITCH_MM,
    plates,
  };
}

export interface CalqueStyle {
  /** Draw each cell's diagonal like the legacy wireframe (default true). */
  diagonals?: boolean;
  /** Line opacity (legacy 0.25). */
  opacity?: number;
  /** Dashed plate boundaries (indigo, like the on-screen preview). */
  plateGrid?: boolean;
  /** Plate names (A1 = north-west) in the north-west corner of each plate. */
  labels?: boolean;
}

/** Overlay colour of the plate grid and labels (design token `--lz-color-accent-text`, light theme). */
export const CALQUE_OVERLAY_RGB: [number, number, number] = [0x2f, 0x39, 0xb3];

type Raster = Uint8ClampedArray;

function blender(img: Raster, W: number, H: number) {
  const blend = (x: number, y: number, a: number, rgb: readonly number[] = [0, 0, 0]) => {
    if (x < 0 || y < 0 || x >= W || y >= H) return;
    const o = (y * W + x) * 4;
    for (let c = 0; c < 3; c++) img[o + c] = img[o + c]! * (1 - a) + rgb[c]! * a;
  };
  /** 1-px line (DDA), each pixel blended once. */
  const line = (x0: number, y0: number, x1: number, y1: number, a: number, rgb?: readonly number[]) => {
    const n = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0), 1);
    let px = -1,
      py = -1;
    for (let k = 0; k <= n; k++) {
      const x = Math.round(x0 + ((x1 - x0) * k) / n),
        y = Math.round(y0 + ((y1 - y0) * k) / n);
      if (x !== px || y !== py) blend(x, y, a, rgb);
      px = x;
      py = y;
    }
  };
  /**
   * Line as WebGL draws a 1-px line lying on a pixel boundary with MSAA: half coverage on the two
   * pixels either side (measured against three r154 + SwiftShader, see README).
   */
  const lineAA = (x0: number, y0: number, x1: number, y1: number, a: number) => {
    const n = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0), 1);
    const steep = Math.abs(y1 - y0) > Math.abs(x1 - x0);
    let px = -1,
      py = -1;
    for (let k = 0; k <= n; k++) {
      const x = Math.round(x0 + ((x1 - x0) * k) / n),
        y = Math.round(y0 + ((y1 - y0) * k) / n);
      if (x !== px || y !== py) {
        blend(x, y, a / 2);
        if (steep) blend(x - 1, y, a / 2);
        else blend(x, y - 1, a / 2);
      }
      px = x;
      py = y;
    }
  };
  return { blend, line, lineAA };
}

/**
 * Modern projection layer (PNG): white background, the outline and one diagonal of every non-empty
 * stud in black at 25 % (the legacy wireframe seen from above), optional plate grid and labels.
 * Row 0 = north edge.
 */
export function rasterizeCalque(hm: HeightMap, l: CalqueLayout, style: CalqueStyle = {}): Raster {
  const W = l.width,
    H = l.height;
  const img = new Uint8ClampedArray(W * H * 4).fill(255);
  const { line } = blender(img, W, H);
  const alpha = style.opacity ?? 0.25;
  for (let j = 0; j < hm.rows; j++) {
    for (let i = 0; i < hm.cols; i++) {
      if (!hm.data[j * hm.cols + i]) continue;
      const x0 = i * l.cell,
        x1 = (i + 1) * l.cell;
      const y0 = (hm.rows - 1 - j) * l.cell,
        y1 = (hm.rows - j) * l.cell;
      line(x0, y0, x1, y0, alpha);
      line(x1, y0, x1, y1, alpha);
      line(x1, y1, x0, y1, alpha);
      line(x0, y1, x0, y0, alpha);
      if (style.diagonals ?? true) line(x0, y1, x1, y0, alpha);
    }
  }
  drawCalqueOverlay(img, l, style);
  return img;
}

/** Legacy brick height in stud units used by the UD-Viz mock-up (9.6 / 7.8). */
const LEGACY_BOX_HEIGHT = 1.230769230769231;
/**
 * Top face of a legacy box lit by the cadastre scene's DirectionalLight from (−20, 20, 20), seen from
 * straight above: Lambert n·l = 1/√3 (linear, three r154 MeshPhongMaterial, legacy lights), encoded
 * to sRGB by the renderer → 200. Specular (0x111111, shininess 30) adds < 0.001.
 */
export const LEGACY_TOP_GREY = 200;

/**
 * Legacy look of `calqueTemplate.jpg` (UD-Viz `LegoMockupVisualizer.generateCadastre`), reproduced
 * from the scene the widget renders (three r154):
 * - one box per non-zero stud, height `value × 1.2308`, centred at y = value / 2 (so its top is at
 *   1.1154 × value), Phong white under one directional light → grey top faces (LEGACY_TOP_GREY);
 * - the orthographic camera sits at y = 11 with near = 1: boxes whose top is above y = 10 (value ≥ 9)
 *   lose their top face and top edges, so the tallest studs show the white background;
 * - `WireframeGeometry` of each box drawn in black at 25 % without depth test: seen from above every
 *   cell edge is covered three times (top edge, bottom edge, side-face diagonal) and the top and
 *   bottom face diagonals cross (an X). Overlapping 25 % lines darken (1 − 0.75ⁿ).
 * Lines spread over the two pixels on each side of a cell boundary, like the GPU's MSAA. Compared
 * with the real three r154 render of `generateCadastre` (SwiftShader), the raster differs only in
 * line anti-aliasing details; the JPEG is encoded by jpeg.ts, not the browser, so files are
 * visually equivalent, not byte-identical (numbers in the README).
 */
export function rasterizeLegacyCalque(hm: HeightMap, l: CalqueLayout, style: CalqueStyle = {}): Raster {
  const W = l.width,
    H = l.height;
  const img = new Uint8ClampedArray(W * H * 4).fill(255);
  const { lineAA: line } = blender(img, W, H);
  const a = 0.25;
  const near = 10; // camera y (11) − near (1)
  // 1. grey top faces
  for (let j = 0; j < hm.rows; j++) {
    for (let i = 0; i < hm.cols; i++) {
      const v = hm.data[j * hm.cols + i]!;
      if (!v || v / 2 + (v * LEGACY_BOX_HEIGHT) / 2 > near) continue;
      const x0 = Math.round(i * l.cell),
        x1 = Math.round((i + 1) * l.cell);
      const y0 = Math.round((hm.rows - 1 - j) * l.cell),
        y1 = Math.round((hm.rows - j) * l.cell);
      for (let y = y0; y < Math.min(y1, H); y++)
        for (let x = x0; x < Math.min(x1, W); x++) {
          const o = (y * W + x) * 4;
          img[o] = img[o + 1] = img[o + 2] = LEGACY_TOP_GREY;
        }
    }
  }
  // 2. wireframes (drawn after every box: depthTest false, transparent pass)
  for (let j = 0; j < hm.rows; j++) {
    for (let i = 0; i < hm.cols; i++) {
      const v = hm.data[j * hm.cols + i]!;
      if (!v) continue;
      const clipped = v / 2 + (v * LEGACY_BOX_HEIGHT) / 2 > near;
      const x0 = i * l.cell,
        x1 = (i + 1) * l.cell;
      const y0 = (hm.rows - 1 - j) * l.cell,
        y1 = (hm.rows - j) * l.cell;
      const times = clipped ? 2 : 3;
      for (let k = 0; k < times; k++) {
        line(x0, y0, x1, y0, a);
        line(x1, y0, x1, y1, a);
        line(x1, y1, x0, y1, a);
        line(x0, y1, x0, y0, a);
      }
      line(x0, y0, x1, y1, a); // bottom face diagonal "\"
      if (!clipped) line(x0, y1, x1, y0, a); // top face diagonal "/"
    }
  }
  drawCalqueOverlay(img, l, style);
  return img;
}

/** Plate grid (dashed) and plate labels on top of a calque raster. */
export function drawCalqueOverlay(img: Raster, l: CalqueLayout, style: CalqueStyle): void {
  const W = l.width,
    H = l.height;
  const { blend } = blender(img, W, H);
  const rgb = CALQUE_OVERLAY_RGB;
  const plateW = STUDS_PER_PLATE * l.cell;
  const thick = Math.max(1, Math.round(plateW / 240));
  const dash = Math.max(4, Math.round(plateW / 40));
  if (style.plateGrid) {
    const cols = Math.round(W / plateW),
      rows = Math.round(H / plateW);
    for (let c = 1; c < cols; c++) {
      const x = Math.round(c * plateW);
      for (let y = 0; y < H; y++)
        if (Math.floor(y / dash) % 3 !== 2)
          for (let t = 0; t < thick; t++) blend(x - (thick >> 1) + t, y, 1, rgb);
    }
    for (let r = 1; r < rows; r++) {
      const y = Math.round(r * plateW);
      for (let x = 0; x < W; x++)
        if (Math.floor(x / dash) % 3 !== 2)
          for (let t = 0; t < thick; t++) blend(x, y - (thick >> 1) + t, 1, rgb);
    }
  }
  if (style.labels) {
    const size = Math.max(9, Math.round(plateW / 14));
    const pad = Math.max(4, Math.round(size / 2));
    for (const p of l.plates)
      drawStrokeText(img, W, H, p.name, Math.round(p.x + pad), Math.round(p.y + pad), size, rgb, {
        halo: [255, 255, 255],
        haloWidth: Math.max(2, size / 6),
      });
  }
}

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]!) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, data.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  dv.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}

/** PNG (RGBA 8-bit) with an optional pHYs chunk so the image prints at the model's real size. */
export function encodePng(
  rgba: Uint8ClampedArray | Uint8Array,
  width: number,
  height: number,
  dpi?: number,
): Uint8Array {
  const raw = new Uint8Array(height * (1 + width * 4));
  for (let y = 0; y < height; y++) {
    raw[y * (1 + width * 4)] = 0; // filter: none
    raw.set(rgba.subarray(y * width * 4, (y + 1) * width * 4), y * (1 + width * 4) + 1);
  }
  const ihdr = new Uint8Array(13);
  const dv = new DataView(ihdr.buffer);
  dv.setUint32(0, width);
  dv.setUint32(4, height);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // colour type RGBA
  const parts = [new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr)];
  if (dpi) {
    const phys = new Uint8Array(9);
    const pdv = new DataView(phys.buffer);
    const ppm = Math.round(dpi / 0.0254);
    pdv.setUint32(0, ppm);
    pdv.setUint32(4, ppm);
    phys[8] = 1; // unit: metre
    parts.push(chunk('pHYs', phys));
  }
  parts.push(chunk('IDAT', zlibSync(raw, { level: 6 })), chunk('IEND', new Uint8Array(0)));
  const total = parts.reduce((a, p) => a + p.length, 0);
  const out = new Uint8Array(total);
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

/** Legacy `calqueTemplate.jpg`: 1920 px long side, legacy look, optional grid and labels. */
export function legacyCalqueJpeg(hm: HeightMap, style: CalqueStyle = {}): Uint8Array {
  const l = legacyCalqueLayout(hm);
  return encodeJpeg(rasterizeLegacyCalque(hm, l, style), l.width, l.height, { quality: 92 });
}

/** PNG at `dpi` with the real size in its pHYs chunk (printing at 100 % gives the model's size). */
export function calquePng(hm: HeightMap, dpi: number, style: CalqueStyle = {}): Uint8Array {
  const l = physicalCalqueLayout(hm, dpi);
  return encodePng(rasterizeCalque(hm, l, style), l.width, l.height, l.dpi);
}
