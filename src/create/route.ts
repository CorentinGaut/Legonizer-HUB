/**
 * Build-guide routes (SPEC §5 /create#guide, O4 deep links, O10 plate passes):
 *   #guide · #guide/bricks[/<plate>] · #guide/build[/<plate>/<layer>] · #guide/table · #guide/downloads
 *   plate passes: #guide/build/<plate>/<layer>&d=<payload>
 */
export type GuideTab = 'bricks' | 'build' | 'table' | 'downloads';

export interface GuideRoute {
  tab: GuideTab;
  plate?: string;
  layer?: number;
  payload?: string;
}

export function parseGuideRoute(hash: string): GuideRoute {
  const h = hash.replace(/^#/, '');
  const [path, query] = h.split(/[&?](.*)/s, 2) as [string, string | undefined];
  const parts = path.split('/');
  const tab = (['bricks', 'build', 'table', 'downloads'] as const).find((x) => x === parts[1]) ?? 'bricks';
  const r: GuideRoute = { tab };
  if ((tab === 'build' || tab === 'bricks') && parts[2] && /^[A-Z]+\d+$/.test(parts[2])) r.plate = parts[2];
  if (tab === 'build' && parts[3] && /^\d+$/.test(parts[3])) r.layer = Number(parts[3]);
  const d = query ? new URLSearchParams(query).get('d') : null;
  if (d) r.payload = d;
  return r;
}

export function guideHash(r: GuideRoute): string {
  let h = `guide/${r.tab}`;
  if (r.tab === 'bricks' && r.plate) h += `/${r.plate}`;
  if (r.tab === 'build' && r.plate) h += `/${r.plate}/${r.layer ?? 1}`;
  return h;
}
