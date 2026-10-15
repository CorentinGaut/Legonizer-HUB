/** Generated at build time by scripts/vite/home-model.ts from src/data/home/home-district.json (synthetic district). */
declare module 'virtual:lz-home-model' {
  export const cols: number;
  export const rows: number;
  export const platesX: number;
  export const platesY: number;
  export const maxLayer: number;
  export const parts: string[];
  /** Base64 of one byte per stud: heights[j * cols + i], j south→north. */
  export const heightsB64: string;
  /** Base64 of 8 bytes per brick: plateCol, plateRowFromNorth, layer, x, y, w, d, partIndex. */
  export const bricksB64: string;
  export const meta: {
    dataset: string;
    attribution: string;
    licence: string;
    scale: number;
    heightMode: string;
    metresPerBrick: number;
    totalBricks: number;
    packingAlgorithm: number;
  };
}
