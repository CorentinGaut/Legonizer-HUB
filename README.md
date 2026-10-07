# Legonizer website

Turns a 3D city model into a buildable model of white bricks on 32 × 32 baseplates: the legacy
height matrix (CSV, identical to UD-Viz 4.6.1 + `legonizer@1.1.0`), plus a parts list, building
instructions, shop exports and a projection layer. Static site, everything runs in the browser.
Specification: [`docs/SPEC.md`](docs/SPEC.md).

Status: **phase 2** — core engine (phase 1); shared shell, home page with its 3D animation and
about page (phase 2A); create wizard and build guide (phase 2B).

## Getting started

This WSL environment has a Windows `npm` on the PATH; always load Node from nvm first.

```sh
source ~/.nvm/nvm.sh
npm install
npm run dev                       # Vite dev server: / (home), /create.html, /about.html
npm test                          # Vitest: unit, property and parity tests
npm run lint                      # ESLint + Prettier check
npm run build                     # type-check + Vite multi-page build (dist/)
npm run e2e                       # Playwright e2e on the production build (vite build + vite preview)
npm run fixtures:lyon -- --all    # download the 16 real Lyon 3 (2018) tiles into fixtures/ (git-ignored)
npm run fixtures:demo             # demo datasets + manifests (sample → public/, Part-Dieu → fixtures/)
npm run fixtures:home             # home-animation heightmap → src/data/home/part-dieu-home.json
npm run stills:home               # home poster + stills rendered from the real animation → src/home/assets/
npm run perf                      # timings for docs/perf.md
```

Real-tile tests (parity on Lyon, demo subset) are skipped when `fixtures/` is empty. The e2e
accessibility tests need `axe-core`: it is not a dependency yet, so they are skipped unless
`AXE_CORE_PATH=/path/to/axe.min.js` is set (see "Dependencies").

## Pages, shared shell and home animation (phase 2A)

```
index.html, about.html   static pages; English text filled at build time from src/i18n/en
src/styles/              index.css = fonts.css (self-hosted) + tokens.css + components.css
                         (design tokens and components) + shell.css; about.css
src/shared/              i18n.ts, shell.ts, theme.ts, icons.ts (+ icons.svg, 68 project icons)
src/i18n/<en|fr>/<ns>.json  one file per namespace (file name = top-level key)
src/home/                hero controller, timeline, scene/ (three.js stage, lazy chunk), assets/
scripts/vite/            Vite plugins: i18n-html (static text), home-model (bricks at build time)
e2e/                     Playwright specs; playwright.config.ts at the root
```

**Shared contract** (used by every page, including the create wizard):

- `import '../styles/index.css'` first in a page entry (it declares the cascade-layer order), then
  page CSS.
- `src/shared/i18n.ts`: `t(key, params?)` (ICU MessageFormat via `intl-messageformat`; plurals and
  numbers follow the locale), `getLocale()`, `setLocale('en' | 'fr')`, `onLocaleChange(cb) → unsubscribe`,
  plus `translateDom(root)` for `data-i18n` / `data-i18n-attr` markup, `formatNumber`, `hasKey`.
  Every `src/i18n/<locale>/*.json` is bundled through `import.meta.glob`; a key missing in French
  falls back to English, an unknown key is returned as is. Locale: `?lang=`, then the stored choice
  (`localStorage['lz-locale']`), then the browser language.
- `src/shared/shell.ts`: `mountShell({ page: 'home' | 'create' | 'about', titleKey?, descriptionKey?, helpHref? })`
  renders `<header id="lz-header">` and `<footer id="lz-footer">`: skip link to `<main id="main">`,
  logo, Create / About / Help (help → `about.html#prepare-data`), EN | FR switch, page action
  (*Create your model*; the create page gets an empty `#lz-header-actions` slot for its project
  menu and the full-width header), phone menu sheet, footer with citation, credit, source code,
  licences, privacy line, theme switch (*Automatic / Light / Dark*) and the trademark
  disclaimer (N9). It re-renders on `setLocale`.
- `src/shared/theme.ts`: `getThemeChoice`, `setThemeChoice`, `getEffectiveTheme`, `onThemeChange`
  (3D views re-read scene colours). Pages add the one-line inline script of `index.html` in
  `<head>` to apply a stored theme before the first paint.

**Home animation** (SPEC §6): a 28 s loop where every
property is a pure function of `t mod 28` (`src/home/timeline.ts`). The brick model is the H4
fixture `src/data/home/part-dieu-home.json` packed **at build time by the real packer**
(`virtual:lz-home-model`; the build fails if the parts differ from the fixture summary): 2,473
bricks on 5 × 3 plates, dropped layer by layer in build order. Bricks, studs and plates are three
instanced draws animated in the vertex shader (one `uTime` uniform). The projector is a pair of
`SpotLight`s with `map` textures (crossfades) covering exactly the 2 × 1 m table (2 : 1 frustum);
the projected layers are drawn with projector parallax so roofs get their own colour; change
colours are the colour-blind-safe `#14B391` / `#B42330` / `#FBE04B`. Building uses, green spaces, tram lines,
changes and media cards are illustrative, derived deterministically from the heights (the page and
the about page say so). Scale figures are smooth one-piece volumes with relaxed poses.

Loading: the poster (`<picture>`, rendered from the same scene at t = 19 s by
`scripts/render-home-stills.ts`) paints first; after `load` + idle the page probes WebGL 2, then
imports the 3D chunk, renders t = 19 s (the poster frame) and crossfades in. No autoplay with
`prefers-reduced-motion` (poster, story as a list, *Play the animation*), without WebGL 2 (poster,
story, note) or on a software renderer (SwiftShader / llvmpipe: poster + *Play animation*; the
frame-rate guard would stop it anyway). Pause/play, chapters, off-screen and hidden-tab pause.
A frame-rate guard steps quality down (shadows 2048 → 1024 → off, DPR 1, static screen) and stops
on the poster below ~7 fps. Test hooks: `window.__lzHome`, `?lz-autoplay=force`, `?lz-speed=N`.

## Create wizard and build guide (phase 2B)

```
create.html, src/pages/create.ts   page entry: shared shell + CreateApp (window.__lzCreate: test hook)
src/create/
  app.ts            layout, stepper (desktop list / phone menu), hash routing, action bar, project menu
  state.ts          project state (persisted) + transient state (jobs, estimates, previews), store
  actions.ts        import (files, folder, zip, URL, demos), estimate, generate, cancel, open project
  engine.ts         EngineService: starts the Worker on first use, restarts it on hard cancel
  persist.ts        IndexedDB autosave (project + source files), resume, quota errors
  route.ts dom.ts format.ts stepView.ts   hash routes, html`` templates, number/size formatting
  steps/            import.ts area.ts settings.ts generate.ts common.ts (table-fit diagram, steppers)
  viewport/         stage.ts (one viewport for steps 1–4), plan.ts (top view + area tool),
                    heightmap2d.ts (2D mode), webgl.ts (WebGL 2 probe), three/ (lazy three.js chunk:
                    view.ts studio rig, models.ts source mesh, bricks, plates, labels)
  create.css
src/guide/
  guide.ts          tabs (Get the bricks · Build · Set up the table · All downloads), summary strip
  bricks.ts         brick shelf, part toggles, spares, baseplate colour, shop lists
  build.ts          step-by-step instructions: build board, 3D / top / list views, table mode, keypad
  diagram.ts        2D layer diagram (text twin, 2D mode, same drawing as the PDF)
  share.ts          plate pass dialog (QR code, link)      plateMode.ts   phone view of a plate pass
  table.ts          table layout + checklist, projection layer preview and export
  downloads.ts      every export card, Download everything (.zip)
  glyphs.ts guide.css
```

- **Wizard (SPEC §7.1–7.4):** steps 1–4 share one viewport. Step 2 edits the area on
  a top view rasterized in the Worker (z-buffer of the real triangles): move, resize by whole plates,
  rotate with snaps, draw a new area, pan/zoom, arrow keys, `[`/`]`, Home, Ctrl+Z (50 steps).
  Settings changes re-run the live estimate (L1 erasure, tallest building, table fit, valid lower
  bound, share of built-up studs left empty); a result that no longer matches the settings is marked out of date until regenerated.
  Every change is saved in IndexedDB; a reload with a step in the URL continues the project.
- **2D mode (SPEC N2):** without WebGL 2 (or with `?webgl=0`) every step works with top views,
  the 2D layer diagram and the height-grid table; the page says why.
- **Build guide (SPEC §7.6, O1–O10):** the shelf, the instructions (Enter = done, keypad codes
  `Numpad*`, table mode for a projector or a big screen), progress per plate and per team, plate
  passes (O10): the plate's heights, part settings and versions are deflated into the URL fragment
  of a QR code; a phone opens it in plate mode, packs that plate in its own Worker and keeps its
  progress locally. Nothing is uploaded.
- **Lazy loading (N5):** the page entry is the wizard UI only; the Worker chunk (importers, BVH,
  packing, exporters) starts on first use, three.js loads with the first 3D view, the guide modules
  with the guide, the PDF module (pdf-lib) inside the Worker on the first PDF, the QR encoder
  (`qrcode` core only) with the share dialog. Sizes in [`docs/perf.md`](docs/perf.md).
- **e2e:** `e2e/create-*.spec.ts` (Playwright, production build). The Part-Dieu specs need
  `npm run fixtures:demo -- --public` (copies the demo into `public/data/demo/part-dieu/`, git-ignored
  until the data licence is confirmed); otherwise they run on the synthetic sample. The G1 spec needs
  `npm run fixtures:lyon -- --all`; accessibility specs need `AXE_CORE_PATH` (see Dependencies).
  Artifacts (downloads, screenshots) go to `e2e-artifacts/create/` (git-ignored).

## Core engine (`src/core/`)

Framework-free, DOM-free TypeScript: it runs in a Web Worker in the browser and in Node for tests
and scripts (Node ≥ 22 runs the `.ts` files directly; imports carry the `.ts` extension and only
erasable TypeScript syntax is used).

```
src/core/
  types.ts              data contracts: CityMesh, Params, Area, HeightMap, PlacedBrick, presets
  version.ts            app / heightmap / packing algorithm versions
  import/               files → CityMesh (Z up, metres, feature ids, bounds)
    fileMap.ts            zip (fflate) and folder uploads → path-keyed map
    tileset.ts            3D Tiles 1.0/1.1: transforms, finest LOD, external tilesets, cmpt, ECEF → ENU
    b3dm.ts gltf.ts       b3dm container, batch table, in-house glTF 2.0 geometry reader
    obj.ts cityjson.ts    OBJ, CityJSON 1.x / CityJSONSeq (LoD ≤ 2.2, semantics, templates)
    units.ts ecef.ts      unit / up-axis handling, WGS84 ECEF ↔ ENU
    remote.ts             tileset URL loader (CORS servers only)
  heightmap/            CityMesh + area + params → height matrix
    legacy.ts             exact UD-Viz numerics (float32 world coords, r147 raycast, AABB area)
    improved.ts           rotated grid, ground reference, supersampling, true scale…
    meshIndex.ts raycast.ts  per-mesh index + three-mesh-bvh candidate search (never changes results)
    estimate.ts area.ts   live feedback (L1 erasure, size, map scale, table fit), default area
  packing/              height matrix → bricks (catalog, beam search, verification, plate names)
  export/               csv, bricklink, rebrickable, ldraw, project, platePass, guide, calque + jpeg +
                        strokeFont + glyphs (projection layer), pdfPlan + pdfGuide (PDF, pdf-lib)
  samples/              synthetic py3dtilers-like datasets, demo manifest type
  worker/               Worker entry, message protocol, engine host, promise client
  util/                 threeCompat (exact three r147/r154 numerics), errors, progress, yielding steps
```

### Pipeline and API

```ts
import { importCityModel, generateHeightMap, packHeightMap, defaultParams, heightMapToCsv, csvFileName } from './src/core/index.ts';

const mesh = importCityModel(files);                         // InputFile[] | FileMap (zips are extracted)
const params = { ...defaultParams(2, 2), keepSmall: true };  // Legacy preset + an option
const area = { cx: 1844330, cy: 5175110, rotationDeg: 0 };   // centre in the data's CRS, metres
const hm = generateHeightMap(mesh, area, params);            // .heightMap, .grid, .sampledRect, .vertical…
const packing = packHeightMap(hm.heightMap, { enabled: ['3001', '3003'], maxLength: 4 });
const csv = heightMapToCsv(hm.heightMap);                    // legacy bytes; csvFileName(2, 2)
```

In the browser the same runs in the engine Worker:

```ts
import { createEngineClient } from './src/core/worker/browser.ts';
const engine = createEngineClient();
const summary = await engine.request('import', { files }, { onProgress }).promise;
const job = engine.request('generate', { area, params, inventory }, { onProgress });
job.cancel();                                  // aborts at the next row / layer
const [file] = await engine.request('export', { kind: 'bricklink' }).promise;
```

Requests: `import`, `import-url`, `estimate`, `generate`, `pack`, `export` (`csv`, `csv-per-plate`,
`bricklink`, `rebrickable`, `ldraw`, `ldraw-mpd`, `project`, `calque-png`, `plate-pass`),
`mesh-preview`, `cancel`. Errors carry a code (`unsupported-format`, `missing-files`,
`empty-geometry`, `invalid-params`, `cancelled`…) for localized messages. Heightmap and packing
are generators that yield every few rows/layers, so `cancel` works without SharedArrayBuffer
(GitHub Pages cannot send the cross-origin isolation headers it needs). Parsing a single file and
building the BVH are not interruptible: `terminate()` the Worker for those.

### Legacy mode and parity (SPEC §3, §10.3)

All options at the "Legacy (UD-Viz 4.6.1)" preset reproduce UD-Viz + `legonizer@1.1.0` exactly,
bugs included. What that requires, all verified by tests:

- **Float32 world coordinates.** UD-Viz merges the selected buildings into a `Float32Array` in
  world coordinates (EPSG:3946 for Lyon): y ≈ 5.17e6 m is stored to the nearest **0.5 m**, x to
  0.125 m. The area corners go through the same float32 rounding.
- **three r147 ray casting.** three r16x replaced `Ray.intersectTriangle` with a watertight
  algorithm, so the latest three does not return the same distances. `util/threeCompat.ts` ports
  the r147 code operation by operation (front faces only, Euclidean distance, bounding-sphere and
  bounding-box pre-tests), checked bit for bit against the real r147 on random and edge-on inputs.
- **iTowns matrix chain.** Tile `transform`s, the glTF Y-up → Z-up scene rotation and node
  matrices are decomposed and recomposed as iTowns 2.41 / three 0.154 do (`Object3D.applyMatrix4`).
- **The BVH cannot change results.** three-mesh-bvh only proposes candidate triangles, with a
  tolerance wider than the float32 rounding; every hit is computed exactly. Tests compare BVH and
  brute force on every option set.
- The area's height is ignored (the UD-Viz box height is a UI artefact; a box tall enough to
  contain the model behaves the same).

The parity harness (`test/parity/legacyReference.ts`) rebuilds the iTowns object graph with the
real three r154, replays `MockUpUtils.createMockUpObject` and the box selector verbatim, then calls
the real `legonizer@1.1.0` (with its own three r147) for the matrix and the CSV, whose data URI is
captured with a minimal `document` stub. It runs on 11 cases: synthetic boxes (rays on edges and
vertices, rotated area), a synthetic slope with gabled roofs, 4 areas of the real Lyon 3 tiles
(including a rotated one), plus a seeded random sweep over the Lyon tiles (12 areas by default;
`PARITY_SWEEP_RUNS=60` checked 60/60, 33,716 non-zero cells). Result: **0 differing cells, CSV
byte-identical**. The legacy file name uses the real plate counts (`legoPlates_<X>_<Y>.csv`, fixing
L8). Two legacy behaviours are deliberately not reproduced: a flat selection (max z = 0) where
legonizer writes `NaN` in every cell (we return zeros and a `flat-geometry` warning), and a UD-Viz
UI quirk where the plate count is recomputed as `trunc(scale.x / scale / 32)` and loses a plate for
4.6 % of (scale, plates) pairs at 1 cm steps (e.g. 0.35 m/stud × 3 plates gives 2); we take the
plate count as given.

When only quantization options change (height mode, rounding, keep small, cap), the exact legacy
sampling is kept, so "Legacy + keep small buildings" differs from Legacy only where a sampled
height is below one brick. Changing selection, height reference, sampling or rotation switches to
the improved pipeline (float64, double-sided hits, highest surface wins).

`rotation: 'aabb'` (legacy) samples the rotated area's bounding box with a square step taken from
its X extent (L3, L9); `'rotate'` turns the grid with the area. Every result returns the
**effective sampled rectangle** (`sampledRect`) and flags when it differs from the drawn one.

### Brick packing (SPEC §7.5.1)

Per plate and layer the mask `H ≥ k` is split into connected components, each solved by a
deterministic beam search over "anchor a brick at the first free stud" (complete: every exact cover
can be produced this way), scored by covered studs minus isolated studs, de-duplicated by Zobrist
hashing, tried in both scan orders, then adjacent bricks forming a catalog part are merged.
Tie-break: bricks bridging seams of the layer below (running bond); the preferred scan order
alternates by layer. 1×1 is always available, so an exact cover always exists. Packing is
**plate-local** (a plate's result depends only on its heights, the part settings and
`PACKING_ALGORITHM_VERSION`), which the plate passes rely on.

Quality: on 84 real Part-Dieu components small enough to solve exactly, the beam uses 1.0 % more
bricks than the optimum. Against the (weak) valid lower bound the gap is about 46 %; see
[`docs/perf.md`](docs/perf.md). Property tests (fast-check) check exact cover, no overlap, no plate
crossing, enabled parts only, determinism and plate-locality.

### Exports and verified external facts

| Export | Format facts | Source (checked 2026-10-06) |
|---|---|---|
| CSV | legonizer `generateCSVwithHeightMap`: north row first, `;`, `\n` after each row | `node_modules/legonizer/src/DataProcessing.js` |
| BrickLink XML | `<INVENTORY><ITEM><ITEMTYPE>P</ITEMTYPE><ITEMID/><COLOR/><MINQTY/>…`; no XML declaration; < 204,800 bytes; White = 1 | [BrickLink help 207](https://www.bricklink.com/help.asp?helpID=207), [colour guide](https://www.bricklink.com/catalogColors.asp) |
| Rebrickable CSV | `Part,Color,Quantity`, White = 15 | [colors.csv](https://cdn.rebrickable.com/media/downloads/colors.csv.gz) (the import help page is behind a bot check) |
| LDraw `.ldr` / `.mpd` | 20 LDU per stud, 24 per brick, −Y up, colour 15; `0 FILE` / `0 NOFILE`; part origin = top-face centre, long side on X | [file format](https://www.ldraw.org/article/218.html), [MPD](https://www.ldraw.org/article/47.html), part files on [library.ldraw.org](https://library.ldraw.org/library/official/parts/3001.dat) |
| Part numbers | 3005, 3004, 3622, 3010, 3009, 3008, 3003, 3002, 3001, 2456, 3007; baseplate 3811 (exists in white: element 6295194, set 11026) | BrickLink catalog pages, Rebrickable `parts.csv` / `elements.csv`, [Brickset 11026](https://brickset.com/parts/in-11026-1) |
| Plate pass (O10) | run-length + raw deflate + base64url URL fragment; QR byte capacities v1–40, levels L/M | ISO/IEC 18004 tables as given by [Thonky](https://www.thonky.com/qr-code-tutorial/character-capacities) |
| Calque PNG | pHYs chunk (pixels per metre) for printing at real size | [PNG spec §11.3.5.3](https://www.w3.org/TR/png-3/#11pHYs) |
| Project file | `.legonizer.json` with SHA-256 of inputs, params, versions, compressed heights | — |

**Projection layer (calque).** `calqueTemplate.jpg` reproduces UD-Viz 4.6.1 `generateCadastre`
without a canvas: an orthographic top view of the height matrix, one quad per stud with its two
diagonals, Phong grey 200 and the near-plane clipping of the tallest cells (value ≥ 9), rasterized in
the Worker and encoded by an in-house baseline JPEG encoder; plate grid and labels are optional
overlays (stroke font). Against a real three r154 WebGL render of the same scene, mean absolute
difference 3.38 / 255 and 0.34 % of pixels off by more than 32 (anti-aliased line edges); not byte
identical (different JPEG encoder and rasterizer). The PNG variant carries a pHYs chunk.

**PDF guide (O5).** `src/core/export/pdfGuide.ts`, pdf-lib in the Worker, A4 or US Letter: cover
with the plate map, shopping list (the shelf on paper, kit per plate), per plate an opener (32 × 32
height grid, kit, plate-pass QR) and its layer diagrams four per page, the projection layer, plate
passes four per page, a technical appendix; every page has a running header and footer. It uses the 14 standard PDF fonts (Helvetica,
Courier) with text mapped to WinAnsi: embedding IBM Plex / Bricolage needs
`@pdf-lib/fontkit`, which is not a dependency.

**Grey baseplates (option).** Light Bluish Gray is BrickLink colour 86 (LEGO Medium Stone
Grey 194, [colour guide](https://www.bricklink.com/catalogColors.asp)) and Rebrickable colour 71
([colors.csv](https://cdn.rebrickable.com/media/downloads/colors.csv.gz)), checked 2026-10-07.

### Data notes

- Lyon tiles (py3dtilers): each child tile has a translation `transform` in EPSG:3946, and its
  bounding volume and positions are relative to that transform. This is standard 3D Tiles. Positions
  are float32, Z-up, in a node with a Z-up → Y-up matrix that the client's Y-up → Z-up rotation
  cancels. Geometry is a non-indexed triangle soup with one contiguous `_BATCHID` run per building.
- Licence: Métropole de Lyon publishes its 3D building products under Licence Ouverte 2.0
  (verified for the 2009 and 2012 textured models and the 2018 roof volumes on data.gouv.fr), but
  not yet for the 2018 buildings behind these tiles. Until then real tiles stay in `fixtures/` and
  the Part-Dieu demo is built there; `node scripts/build-demo-datasets.ts --public` writes it to
  `public/data/demo/` once the licence is confirmed. The synthetic sample is ours and ships in `public/`.

## Dependencies

| Package | Why |
|---|---|
| `three` | Required by three-mesh-bvh (BufferGeometry, Box3) and its Earcut triangulator; phase 2 rendering |
| `three-mesh-bvh` | BVH for the vertical rays (SPEC §9) |
| `fflate` | zip extraction, deflate for plate passes / project heights, PNG zlib; 8 kB, Worker-friendly |
| dev: `typescript`, `vite`, `vitest`, `fast-check`, `eslint` + `typescript-eslint` + `eslint-config-prettier`, `prettier`, `@types/*`, `globals` | build, tests, lint |
| dev: `legonizer@1.1.0` (+ its nested three r147), `three-r154` (alias of three 0.154) | parity reference: the exact code and three versions UD-Viz 4.6.1 ran |
| `intl-messageformat` | ICU plurals and locale number formatting for EN/FR (SPEC N6); the messages in `src/i18n/` are written in ICU |
| `@fontsource-variable/bricolage-grotesque`, `@fontsource/ibm-plex-sans`, `@fontsource/ibm-plex-mono` | self-hosted fonts (no request to Google Fonts), OFL-1.1; only latin + latin-ext declared |
| dev: `@playwright/test` | e2e tests, poster/stills rendering (headless Chromium with SwiftShader) |
| `pdf-lib` | PDF build guide (O5) in the Worker: pure JavaScript, runs in Workers and in Node tests, MIT |
| `qrcode` (core encoder only, `qrcode/lib/core/qrcode.js`) + dev `@types/qrcode` | plate-pass QR codes (O10), drawn as SVG on screen and as vector squares in the PDF, MIT |
| not installed (proposed dev dependency): `axe-core` | accessibility e2e tests; used from outside the repository so far, see `e2e/home-a11y.spec.ts` |

glTF and b3dm are parsed in-house rather than with three's `GLTFLoader`: we need only geometry,
feature ids and the exact float32 data and matrix chain; GLTFLoader also builds materials and
textures (image decoding needs the DOM or ImageBitmap), which does not run in Node tests.

## Licences and credits

Upstream: `legonizer` (ISC), UD-Viz (LGPL-2.1), paper by Le Bihan Gautier, Delanoy, Gesquière
(JFIG 2024, CC0). Data: Métropole de Lyon, 3D Tiles by LIRIS / VCity. LEGO® is a trademark of the
LEGO Group, which does not sponsor, authorize or endorse this site.
