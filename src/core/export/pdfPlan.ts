/**
 * PDF build guide (SPEC O5): page plan and the localized messages the renderer needs. Kept apart
 * from the renderer (pdfGuide.ts, which pulls pdf-lib) so the page can show "About 46 pages" and
 * collect the messages without loading the PDF library.
 */
import type { PackingResult } from '../packing/pack.ts';
import { TILES } from '../packing/catalog.ts';

export type PaperSize = 'A4' | 'Letter';

/** ISO 216 A4 = 210 × 297 mm; US Letter = 8.5 × 11 in = 215.9 × 279.4 mm. */
export const PAPER_MM: Record<PaperSize, [number, number]> = { A4: [210, 297], Letter: [215.9, 279.4] };

export interface PdfSections {
  /** Cover with the plate map and the "how to use" steps (+ the technical appendix at the end). */
  cover: boolean;
  /** Shopping list: the shelf on paper and the kit per plate. */
  shopping: boolean;
  /** One opener page per plate: height grid, kit, plate pass QR. */
  plates: boolean;
  /** Layer diagrams, four per page. */
  layers: boolean;
  projection: boolean;
  passes: boolean;
}

export const ALL_SECTIONS: PdfSections = {
  cover: true,
  shopping: true,
  plates: true,
  layers: true,
  projection: true,
  passes: true,
};

export const LAYERS_PER_PAGE = 4;
export const PASSES_PER_PAGE = 4;
/** Plate rows of the "kit per plate" table on one page (continued on the next pages). */
export const KIT_ROWS_FIRST_PAGE = 18;
export const KIT_ROWS_PER_PAGE = 46;
/** Each row of cap-tile slots on the parts page takes the room of this many kit rows. */
const KIT_ROWS_PER_TILE_ROW = 9;

/** Kit rows on the parts page, after `tileRows` rows of cap-tile slots (6 tile kinds per row). */
export function kitRowsFirstPage(tileRows: number): number {
  return Math.max(0, KIT_ROWS_FIRST_PAGE - KIT_ROWS_PER_TILE_ROW * tileRows);
}

/** Rows of cap-tile slots on the parts page. */
export function tileSlotRows(counts: Record<string, number>): number {
  return Math.ceil(TILES.filter((t) => (counts[t.id] ?? 0) > 0).length / 6);
}

/** Number of pages the renderer will produce. */
export function pdfPageCount(
  packing: Pick<PackingResult, 'plates'> & Partial<Pick<PackingResult, 'counts'>>,
  s: PdfSections = ALL_SECTIONS,
): number {
  const n = packing.plates.length;
  const first = kitRowsFirstPage(tileSlotRows(packing.counts ?? {}));
  let pages = 0;
  if (s.cover) pages += 2; // cover + technical appendix
  if (s.shopping) pages += 1 + Math.max(0, Math.ceil((n - first) / KIT_ROWS_PER_PAGE));
  for (const p of packing.plates) {
    if (s.plates) pages += 1;
    if (s.layers) pages += Math.ceil(p.layers / LAYERS_PER_PAGE);
  }
  if (s.projection) pages += 1;
  if (s.passes) pages += Math.ceil(n / PASSES_PER_PAGE);
  return Math.max(1, pages);
}

/** i18n keys (ICU MessageFormat) the PDF renderer formats; the page passes their raw messages. */
export const PDF_MESSAGE_KEYS = [
  'exports.pdf.title',
  'exports.pdf.cover.madeWith',
  'exports.pdf.cover.settings',
  'exports.pdf.cover.accessibleVersion',
  'exports.pdf.cover.howToTitle',
  'exports.pdf.cover.howTo1',
  'exports.pdf.cover.howTo2',
  'exports.pdf.cover.howTo3',
  'exports.pdf.cover.howTo4',
  'exports.pdf.cover.howTo5',
  'exports.pdf.cover.plateMap',
  'exports.pdf.cover.plateMapNote',
  'exports.pdf.cover.mapHint',
  'exports.pdf.cover.facts.onTable',
  'exports.pdf.cover.facts.onTableValue',
  'exports.pdf.cover.facts.onGround',
  'exports.pdf.cover.facts.onGroundValue',
  'exports.pdf.cover.facts.scale',
  'exports.pdf.cover.facts.scaleValue',
  'exports.pdf.cover.facts.preset',
  'exports.pdf.cover.facts.differs',
  'exports.pdf.cover.facts.bricks',
  'exports.pdf.cover.facts.tallest',
  'exports.pdf.cover.facts.tallestValue',
  'exports.pdf.pageFooter',
  'exports.pdf.pageNumber',
  'exports.pdf.heightGridTitle',
  'exports.pdf.heightGridNote',
  'exports.pdf.heightLegend',
  'exports.pdf.kitTitle',
  'exports.pdf.layerTitle',
  'exports.pdf.layersRange',
  'exports.pdf.newBricks',
  'exports.pdf.legendNew',
  'exports.pdf.legendBelow',
  'exports.pdf.legendNote',
  'exports.pdf.projectionPageNote',
  'exports.pdf.scaleBar',
  'exports.pdf.platePosition',
  'exports.pdf.plateSummary',
  'exports.pdf.emptyPlate',
  'exports.pdf.kitPerPlate',
  'exports.pdf.kitPerPlateNote',
  'exports.pdf.tickTray',
  'exports.pdf.baseplateScale',
  'exports.pdf.baseplateName',
  'exports.pdf.spare',
  'exports.pdf.total',
  'exports.pdf.continued',
  'exports.pdf.sections.cover',
  'exports.pdf.sections.shopping',
  'exports.pdf.sections.projection',
  'exports.pdf.sections.passes',
  'exports.pdf.sections.appendix',
  'exports.pdf.appendix.title',
  'exports.pdf.appendix.settings',
  'exports.pdf.appendix.inputs',
  'exports.pdf.appendix.files',
  'exports.pdf.appendix.filesBody',
  'exports.pdf.appendix.credits',
  'exports.pdf.appendix.legacyValue',
  'exports.pdf.appendix.changedValue',
  'exports.pdf.appendix.noInputs',
  'exports.pdf.shoppingTitle',
  'exports.pdf.white',
  'exports.pdf.lowerBound',
  'exports.pass.title',
  'exports.pass.layers',
  'exports.pass.scan',
  'exports.pass.position',
  'exports.pass.tooLarge',
  'exports.pass.footer',
  'exports.pass.cut',
  'exports.projection.title',
  'exports.projection.eyebrow',
  'create.guide.table.projection.howTo.step1',
  'create.guide.table.projection.howTo.step2',
  'create.guide.table.projection.howTo.step3',
  'create.guide.bricks.rows.oneWide',
  'create.guide.bricks.rows.twoWide',
  'create.guide.bricks.rows.baseplates',
  'create.guide.bricks.rows.tiles',
  'exports.pdf.tileSize',
  'exports.pdf.tilesColumn',
  'create.guide.bricks.table.part',
  'create.guide.bricks.table.number',
  'create.guide.bricks.total',
  'create.guide.build.plateMap.status.empty',
  'common.plate.name',
  'footer.trademark',
] as const;
