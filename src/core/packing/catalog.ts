/**
 * White brick catalog (SPEC §7.5.1). Facts verified on 2026-10-06 from primary sources:
 *
 * - Part numbers and names: BrickLink catalog pages (https://www.bricklink.com/v2/catalog/catalogitem.page?P=<id>,
 *   e.g. "Brick 1 x 3 : Part 3622"), Rebrickable database export parts.csv
 *   (https://cdn.rebrickable.com/media/downloads/parts.csv.gz) — identical ids for all 12 parts.
 * - All 12 exist in white: Rebrickable elements.csv (colour 15), e.g. 300101-family elements;
 *   white baseplate 3811 = element 6295194 (Brickset, set 11026 "White Baseplate").
 * - Colours: BrickLink White = 1 (https://www.bricklink.com/catalogColors.asp);
 *   Rebrickable White = 15 (colors.csv); LDraw White = 15 (LDConfig.ldr).
 * - LDraw geometry (https://library.ldraw.org/library/official/parts/<id>.dat): every brick has its
 *   origin at the centre of the top face, body from y = 0 to y = 24 LDU (−Y is up), long side along
 *   X (±10·L LDU), short side along Z (±10·W LDU). 3811.dat: top face at y = 0, ±320 LDU.
 *
 * Tiles (smooth cap, `InventoryOptions.tileCap`): flat tiles with groove, 1/3 brick high (8 LDU), no studs.
 * Same ids on BrickLink, Rebrickable and LDraw (3070b, 3069b, 63864, 2431, 6636, 4162, 3068b, 26603,
 * 87079, 69729); LDraw origin at the centre of the top face, body from y = 0 to y = 8, long side along X.
 */

export interface BrickPart {
  /** Design id, identical on BrickLink, Rebrickable and LDraw for these parts. */
  id: string;
  /** Short side (studs). */
  width: number;
  /** Long side (studs). */
  length: number;
  name: string;
  ldrawFile: string;
  /** 'tile': flat, no studs, 1/3 brick high (8 LDU); 'brick': 24 LDU; 'baseplate'. */
  kind: 'brick' | 'tile' | 'baseplate';
}

/** Smooth cap (tiles on top of the model): none, on every column of height ≥ 1, or also on the ground. */
export type TileCapMode = 'none' | 'roofs' | 'all';
export const TILE_CAP_MODES: readonly TileCapMode[] = ['none', 'roofs', 'all'];

export const BRICKS: readonly BrickPart[] = [
  { id: '3005', width: 1, length: 1, name: 'Brick 1 x 1', ldrawFile: '3005.dat', kind: 'brick' },
  { id: '3004', width: 1, length: 2, name: 'Brick 1 x 2', ldrawFile: '3004.dat', kind: 'brick' },
  { id: '3622', width: 1, length: 3, name: 'Brick 1 x 3', ldrawFile: '3622.dat', kind: 'brick' },
  { id: '3010', width: 1, length: 4, name: 'Brick 1 x 4', ldrawFile: '3010.dat', kind: 'brick' },
  { id: '3009', width: 1, length: 6, name: 'Brick 1 x 6', ldrawFile: '3009.dat', kind: 'brick' },
  { id: '3008', width: 1, length: 8, name: 'Brick 1 x 8', ldrawFile: '3008.dat', kind: 'brick' },
  { id: '3003', width: 2, length: 2, name: 'Brick 2 x 2', ldrawFile: '3003.dat', kind: 'brick' },
  { id: '3002', width: 2, length: 3, name: 'Brick 2 x 3', ldrawFile: '3002.dat', kind: 'brick' },
  { id: '3001', width: 2, length: 4, name: 'Brick 2 x 4', ldrawFile: '3001.dat', kind: 'brick' },
  { id: '2456', width: 2, length: 6, name: 'Brick 2 x 6', ldrawFile: '2456.dat', kind: 'brick' },
  { id: '3007', width: 2, length: 8, name: 'Brick 2 x 8', ldrawFile: '3007.dat', kind: 'brick' },
];

export const BASEPLATE: BrickPart = {
  id: '3811',
  width: 32,
  length: 32,
  name: 'Baseplate 32 x 32',
  ldrawFile: '3811.dat',
  kind: 'baseplate',
};

export const TILES: readonly BrickPart[] = [
  { id: '3070b', width: 1, length: 1, name: 'Tile 1 x 1', ldrawFile: '3070b.dat', kind: 'tile' },
  { id: '3069b', width: 1, length: 2, name: 'Tile 1 x 2', ldrawFile: '3069b.dat', kind: 'tile' },
  { id: '63864', width: 1, length: 3, name: 'Tile 1 x 3', ldrawFile: '63864.dat', kind: 'tile' },
  { id: '2431', width: 1, length: 4, name: 'Tile 1 x 4', ldrawFile: '2431.dat', kind: 'tile' },
  { id: '6636', width: 1, length: 6, name: 'Tile 1 x 6', ldrawFile: '6636.dat', kind: 'tile' },
  { id: '4162', width: 1, length: 8, name: 'Tile 1 x 8', ldrawFile: '4162.dat', kind: 'tile' },
  { id: '3068b', width: 2, length: 2, name: 'Tile 2 x 2', ldrawFile: '3068b.dat', kind: 'tile' },
  { id: '26603', width: 2, length: 3, name: 'Tile 2 x 3', ldrawFile: '26603.dat', kind: 'tile' },
  { id: '87079', width: 2, length: 4, name: 'Tile 2 x 4', ldrawFile: '87079.dat', kind: 'tile' },
  { id: '69729', width: 2, length: 6, name: 'Tile 2 x 6', ldrawFile: '69729.dat', kind: 'tile' },
];

/** Bricks then tiles, in catalog order (parts lists, shop exports). */
export const ALL_PARTS: readonly BrickPart[] = [...BRICKS, ...TILES];

const ONE_BY_ONE_TILE_ID = '3070b';

export function isTile(id: string): boolean {
  return TILES.some((t) => t.id === id);
}

const ONE_BY_ONE_ID = '3005';

export const COLOR_WHITE = { bricklink: 1, rebrickable: 15, ldraw: 15 } as const;

export function partById(id: string): BrickPart | undefined {
  return id === BASEPLATE.id ? BASEPLATE : ALL_PARTS.find((b) => b.id === id);
}

export interface InventoryOptions {
  /** Enabled part ids (default: all). The 1×1 (3005) is always enabled so an exact cover always exists (SPEC §7.5.1). */
  enabled?: readonly string[];
  /** Longest allowed side in studs (default 8); applies to tiles too. */
  maxLength?: number;
  /** Smooth tile cap on top of the model (default 'none'). */
  tileCap?: TileCapMode;
}

/** A placeable shape: w studs along x (east), d along y (north). */
export interface Shape {
  part: BrickPart;
  w: number;
  d: number;
  rotation: 0 | 90;
  area: number;
}

/** Enabled shapes in both orientations, largest area first (ties: wider along x first). Deterministic. */
export function enabledShapes(opts: InventoryOptions = {}): Shape[] {
  return shapesOf(BRICKS, ONE_BY_ONE_ID, opts);
}

/** Tile shapes for the cap: every tile up to `maxLength` (the 1×1 tile always), brick `enabled` list ignored. */
export function tileShapes(opts: InventoryOptions = {}): Shape[] {
  return shapesOf(TILES, ONE_BY_ONE_TILE_ID, { maxLength: opts.maxLength });
}

function shapesOf(parts: readonly BrickPart[], oneByOne: string, opts: InventoryOptions): Shape[] {
  const maxLength = opts.maxLength ?? 8;
  const enabled = opts.enabled ? new Set(opts.enabled) : null;
  const shapes: Shape[] = [];
  for (const part of parts) {
    const always = part.id === oneByOne;
    if (!always && enabled && !enabled.has(part.id)) continue;
    if (!always && part.length > maxLength) continue;
    shapes.push({ part, w: part.length, d: part.width, rotation: 0, area: part.length * part.width });
    if (part.length !== part.width)
      shapes.push({ part, w: part.width, d: part.length, rotation: 90, area: part.length * part.width });
  }
  shapes.sort((a, b) => b.area - a.area || b.part.length - a.part.length || b.w - a.w);
  return shapes;
}

export const ONE_BY_ONE = BRICKS[0]!;

export interface NormalizedInventory {
  enabled: string[];
  maxLength: number;
  tileCap: TileCapMode;
}

/** Normalized inventory: enabled ids in catalog order (1×1 always included), max length and cap. */
export function normalizeInventory(opts: InventoryOptions = {}): NormalizedInventory {
  const shapes = enabledShapes(opts);
  const ids = new Set(shapes.map((s) => s.part.id));
  return {
    enabled: BRICKS.filter((b) => ids.has(b.id)).map((b) => b.id),
    maxLength: opts.maxLength ?? 8,
    tileCap: TILE_CAP_MODES.includes(opts.tileCap as TileCapMode) ? opts.tileCap! : 'none',
  };
}

/** Cells of a column of height `h` that get a cap tile (at layer h + 1). */
export function tileCapsColumn(tileCap: TileCapMode | undefined, h: number): boolean {
  return tileCap === 'all' ? h >= 0 : tileCap === 'roofs' ? h >= 1 : false;
}

/** Kit / callout order: largest brick first, then cap tiles, largest first. */
export const KIT_ORDER: readonly BrickPart[] = [...[...BRICKS].reverse(), ...[...TILES].reverse()];
