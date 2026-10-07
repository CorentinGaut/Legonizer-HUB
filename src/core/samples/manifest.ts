/**
 * Demo dataset manifest (SPEC I10, v1.1): each bundled demo carries a curated default area and
 * suggested settings. The synthetic sample suggests "Legacy + Keep small buildings" with a
 * one-click switch to strict Legacy.
 */
import type { Area, Bounds3, Params } from '../types.ts';

export interface DemoManifest {
  formatVersion: 1;
  id: string;
  title: string;
  description: string;
  /** Archive (3D Tiles as a zip), relative to the manifest. */
  archive: string;
  bytes: number;
  sha256: string;
  format: '3dtiles';
  crs?: string;
  source: {
    name: string;
    url?: string;
    licence: string;
    licenceUrl?: string;
    attribution: string;
    /** True when the data may be redistributed with the site (our own synthetic data). */
    licenceVerified: boolean;
  };
  stats: { triangles: number; features: number; tiles: number };
  bounds: Bounds3;
  defaultArea: { area: Area; platesX: number; platesY: number };
  suggested: {
    params: Params;
    /** Short explanation shown with the suggestion (localized by the UI from `noteKey`). */
    noteKey: string;
    note: string;
    /** Strict legacy preset for the one-click switch. */
    strictLegacy: Params;
  };
  generated: { app: string; date: string };
}
