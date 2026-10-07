/**
 * Unit and up-axis handling for generic meshes (glTF, OBJ) — SPEC I3, I6.
 * The CityMesh world frame is always Z up, metres.
 */
import type { CityMesh } from '../types.ts';
import { transformMesh } from './cityMesh.ts';
import type { Mat4 } from '../util/threeCompat.ts';

export type LengthUnit = 'm' | 'cm' | 'mm' | 'ft';
export type UpAxis = 'y' | 'z';

export interface GenericMeshOptions {
  unit?: LengthUnit | 'auto';
  upAxis?: UpAxis | 'auto';
}

export const METRES_PER_UNIT: Record<LengthUnit, number> = { m: 1, cm: 0.01, mm: 0.001, ft: 0.3048 };

/** Scale to metres then rotate Y-up to Z-up: (x, y, z) → (x, −z, y) (exact, no trig round-off). */
export function frameMatrix(unit: LengthUnit, up: UpAxis): Mat4 {
  const s = METRES_PER_UNIT[unit];
  const m = new Float64Array(16);
  if (up === 'y') {
    m[0] = s;
    m[6] = s; // y → z
    m[9] = -s; // z → −y
  } else {
    m[0] = s;
    m[5] = s;
    m[10] = s;
  }
  m[15] = 1;
  return m;
}

/**
 * City models are wide and flat: the up axis is the one (of Y and Z) whose extent is clearly the
 * smaller (< 0.6 × the other). When both are similar the model gives no signal and Y-up — the
 * glTF and Blender OBJ default — is assumed; the warning tells the user to check the summary.
 */
export function detectUpAxis(size: [number, number, number]): { axis: UpAxis; confident: boolean } {
  if (size[1] < 0.6 * size[2]) return { axis: 'y', confident: true };
  if (size[2] < 0.6 * size[1]) return { axis: 'z', confident: true };
  return { axis: 'y', confident: false };
}

/**
 * Heuristic: a city model in metres is never more than ~5 km tall (relief included); a taller
 * extent means centimetres (or millimetres beyond 500 km). Feet cannot be told from metres and
 * are never auto-detected: the UI shows the size so the user can override.
 */
export function detectUnit(verticalExtent: number): LengthUnit {
  if (verticalExtent > 500_000) return 'mm';
  if (verticalExtent > 5_000) return 'cm';
  return 'm';
}

/**
 * Applies unit / up-axis to a mesh whose parts are in the file's raw frame.
 * `defaultUp` is the format's convention ('y' for glTF), used when `upAxis` is 'auto' and the
 * format defines one; otherwise the axis is detected from the extents.
 */
export function applyGenericFrame(mesh: CityMesh, opts: GenericMeshOptions, defaultUp: UpAxis | null): void {
  const size: [number, number, number] = [
    mesh.bounds.max[0] - mesh.bounds.min[0],
    mesh.bounds.max[1] - mesh.bounds.min[1],
    mesh.bounds.max[2] - mesh.bounds.min[2],
  ];
  let up: UpAxis;
  let upDetected = false;
  if (opts.upAxis && opts.upAxis !== 'auto') up = opts.upAxis;
  else if (defaultUp) up = defaultUp;
  else {
    upDetected = true;
    const d = detectUpAxis(size);
    up = d.axis;
    mesh.warnings.push(
      d.confident
        ? `Up axis auto-detected: ${up.toUpperCase()}-up.`
        : `Up axis could not be detected (model about as deep as tall): assumed Y-up; check the size summary.`,
    );
  }
  const vertical = up === 'y' ? size[1] : size[2];
  let unit: LengthUnit;
  let unitDetected = false;
  if (opts.unit && opts.unit !== 'auto') unit = opts.unit;
  else {
    unitDetected = true;
    unit = detectUnit(vertical);
    if (unit !== 'm')
      mesh.warnings.push(`Unit auto-detected: ${unit} (model is ${vertical.toFixed(0)} units tall).`);
  }
  mesh.meta = { ...mesh.meta, unit, unitDetected, upAxis: up, upDetected };
  if (unit !== 'm' || up !== 'z') transformMesh(mesh, frameMatrix(unit, up));
}
