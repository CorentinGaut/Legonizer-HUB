/**
 * Printable PDF build guide (SPEC O5). The renderer lives in pdfGuide.ts (pdf-lib, loaded on demand
 * by the engine Worker); the page plan and message keys in pdfPlan.ts (light, used by the page).
 */
export {
  ALL_SECTIONS,
  PAPER_MM,
  PDF_MESSAGE_KEYS,
  pdfPageCount,
  type PaperSize,
  type PdfSections,
} from './pdfPlan.ts';
export type { PdfGuideInput } from './pdfGuide.ts';
