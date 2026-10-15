/**
 * BrickLink wanted list XML (SPEC O6). Format from BrickLink's help page "Wanted List Upload"
 * (https://www.bricklink.com/help.asp?helpID=207, checked 2026-10-06): root <INVENTORY>, one <ITEM>
 * per lot with <ITEMTYPE>P</ITEMTYPE> and <ITEMID>, optional <COLOR>, <MINQTY>, <CONDITION> (N/U),
 * <MAXPRICE>, <REMARKS>, <NOTIFY> (Y/N), <WANTEDSHOW> (Y/N), <WANTEDLISTID>. "A wanted list in
 * BrickLink XML format can not have an XML declaration." The uploader takes pasted text, total
 * size under 204,800 bytes (SPEC v1.1 §12). White = colour 1 (BrickLink colour guide).
 */
import { COLOR_WHITE } from '../packing/catalog.ts';
import type { PackingResult } from '../packing/pack.ts';
import { partLines } from './parts.ts';

export const BRICKLINK_MAX_BYTES = 204_800;

export interface BrickLinkOptions {
  includeBaseplates?: boolean;
  condition?: 'N' | 'U';
  wantedListId?: number;
  remarks?: string;
  notify?: boolean;
}

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

export function brickLinkXml(
  packing: Pick<PackingResult, 'counts' | 'baseplates'>,
  opts: BrickLinkOptions = {},
): string {
  const lines = ['<INVENTORY>'];
  for (const p of partLines(packing, opts.includeBaseplates ?? true)) {
    lines.push('  <ITEM>');
    lines.push('    <ITEMTYPE>P</ITEMTYPE>');
    lines.push(`    <ITEMID>${esc(p.partId)}</ITEMID>`);
    lines.push(`    <COLOR>${COLOR_WHITE.bricklink}</COLOR>`);
    lines.push(`    <MINQTY>${p.quantity}</MINQTY>`);
    if (opts.condition) lines.push(`    <CONDITION>${opts.condition}</CONDITION>`);
    if (opts.remarks) lines.push(`    <REMARKS>${esc(opts.remarks)}</REMARKS>`);
    if (opts.notify !== undefined) lines.push(`    <NOTIFY>${opts.notify ? 'Y' : 'N'}</NOTIFY>`);
    if (opts.wantedListId !== undefined) lines.push(`    <WANTEDLISTID>${opts.wantedListId}</WANTEDLISTID>`);
    lines.push('  </ITEM>');
  }
  lines.push('</INVENTORY>');
  const xml = lines.join('\n') + '\n';
  if (new TextEncoder().encode(xml).length >= BRICKLINK_MAX_BYTES) {
    throw new Error(`BrickLink wanted list exceeds ${BRICKLINK_MAX_BYTES} bytes`);
  }
  return xml;
}
