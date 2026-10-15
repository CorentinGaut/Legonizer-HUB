# Performance (core engine, phase 1)

Measured 2026-10-06 with `node scripts/perf.ts --baseline` (needs `npm run fixtures:lyon -- --all`).

**Machine**: AMD Ryzen 7 3700X (8 cores / 16 threads, desktop, 2019), 8 GiB RAM visible to WSL2,
Linux 6.18 (WSL2 on Windows), Node v26.9.0. Single thread (the engine runs in one Worker). Node
runs the same V8 engine as Chrome; browser timings, including a mid-range laptop, are to be
measured in phase 2 with the real Worker. A 2019 8-core desktop is somewhat faster per thread than
a current mid-range laptop, so expect browser numbers up to about 1.5–2× these.

## SPEC G1 — 4 × 4 plates on ~1 M triangles in < 5 s

Datasets: real Lyon 3 (2018) 3D Tiles (16 b3dm, 540,867 triangles, 5,053 buildings) and the same
tiles plus a copy shifted 4.5 km east with renamed `gml_id`s (1,081,734 triangles). Area: 4 × 4
plates at 3 m/stud (384 × 384 m, 16,384 studs) centred on Part-Dieu (1844300, 5175100).

| Dataset | Triangles | Import (parse) | Index | BVH build | Variant | Heightmap | Packing (bricks) | Generate: first / next |
|---|---|---|---|---|---|---|---|---|
| Lyon 3 | 540,867 | 151 ms | 78 ms | 371 ms | Legacy preset (exact UD-Viz numerics) | 94 ms | 147 ms (1,027) | 613 ms / 242 ms |
| Lyon 3 | 540,867 | 151 ms | 78 ms | 371 ms | Legacy + keep small | 57 ms | 134 ms (1,279) | 563 ms / 191 ms |
| Lyon 3 | 540,867 | 151 ms | 78 ms | 371 ms | True scale, ground, centre, rotate | 55 ms | 797 ms (6,495) | 1,223 ms / 852 ms |
| Lyon 3 | 540,867 | 151 ms | 78 ms | 371 ms | Supersample 4×4 (max), true scale, rotated 20° | 500 ms | 821 ms (6,976) | 1,692 ms / 1,321 ms |
| Lyon 3 ×2 | 1,081,734 | 790 ms | 443 ms | 967 ms | Legacy preset (exact UD-Viz numerics) | 109 ms | 124 ms (1,027) | 1,200 ms / 233 ms |
| Lyon 3 ×2 | 1,081,734 | 790 ms | 443 ms | 967 ms | Legacy + keep small | 58 ms | 146 ms (1,279) | 1,171 ms / 204 ms |
| Lyon 3 ×2 | 1,081,734 | 790 ms | 443 ms | 967 ms | True scale, ground, centre, rotate | 50 ms | 821 ms (6,495) | 1,839 ms / 872 ms |
| Lyon 3 ×2 | 1,081,734 | 790 ms | 443 ms | 967 ms | Supersample 4×4 (max), true scale, rotated 20° | 519 ms | 851 ms (6,976) | 2,337 ms / 1,370 ms |

- "First" generation includes building the BVH (once per imported model, cached); "next" is any
  later generation with other parameters or another area.
- From files to bricks on 1.08 M triangles: import 0.79 s + index 0.44 s + first generation
  1.2–2.3 s = **2.4–3.6 s**, under the 5 s target on this machine.
- Packing dominates in true-scale mode (many layers): about 0.12 ms per brick with the default beam
  width 12 and both scan orders.

## Baseline: legonizer@1.1.0 (L6)

Same Part-Dieu 4 × 4 area, run through the original code (three r147 `Mesh.raycast` over every
selected triangle, no spatial index): **4,646 ms** for 16,384 rays against only 8,480 selected
triangles. The cost grows linearly with the number of selected triangles; our legacy path gives
the identical matrix in about 100 ms once the BVH exists.

## Bundle sizes (N5)

`npm run build`, Vite 8, minified:

| Chunk | Raw | gzip -9 |
|---|---|---|
| `engine.worker` (core + three + three-mesh-bvh + fflate) | 251 kB | 80 kB |
| `create` page entry (phase 1 debug: re-exports the whole core) | 257 kB | 84 kB |
| `index` (home) page entry | — (empty in phase 1) | — |

The home page does not import the core. In phase 2, the create page's main thread should import
only the light modules (types, worker client, export helpers), not `src/core/index.ts`, so that three
and the BVH stay in the Worker chunk. (Done: see "Create page (phase 2B)" below for the current sizes.)

## Packing quality on the same runs

| Variant | Bricks | Valid lower bound | ⌈area / 8⌉ (spec's bound) |
|---|---|---|---|
| Legacy 4 × 4 Part-Dieu | 1,027 | 704 | 1,295 |
| True scale, ground, keep small | 6,495 | 4,406 | 8,243 |

The valid lower bound (max of area / largest fitting brick and outline vertices / 4, per
component) is weak on jagged footprints. To measure the real gap, 84 components of the
true-scale Part-Dieu layers small enough to solve exactly (6–70 studs) were solved by exhaustive
branch-and-bound: the beam search used **1.0 % more bricks than the optimum** (397 vs 393; 4
components were one brick worse).

# Home page (phase 2A)

Measured 2026-10-06 on the machine above (WSL2, **no hardware GPU reachable from Chromium**:
WebGL runs on SwiftShader or Mesa llvmpipe, both CPU rasterizers). Headless Chromium 1243
(Playwright 1.63), production build served by `vite preview`.

## Bundle sizes (N5: home JS ≤ 300 kB gzip before the 3D chunk)

Full multi-page `vite build` (Vite 8, gzip as reported by Vite):

| Loaded | Files | Raw | gzip |
|---|---|---|---|
| Before the 3D (home) | `index` entry 9.5 kB + `shell` (shell, i18n, intl-messageformat, every EN/FR namespace) 127.4 kB + preload helper 1.4 kB | 138 kB | **46 kB** |
| CSS | `shell` (fonts, tokens, components, shell) 87.1 kB + `index` 2.9 kB | 90 kB | 16 kB |
| 3D chunk, after `load` + idle | `stage` (scene code + packed model: the synthetic district, 1,848 bricks; 2026-10-07) 81.5 kB + `three.module` 556 kB (shared with the create page) | 637 kB | **165 kB** |
| Poster (LCP) | `poster-desktop` 1920 × 984 / `-1280` / `poster-mobile` 780 × 880 (WebP) | 47 / 27 / 18 kB | — |
| Preloaded fonts | Bricolage Grotesque latin (opsz + wght) 77 kB, IBM Plex Sans 400 latin 23 kB | 100 kB | — |

## Lighthouse 13 (home and about, production build)

`npx lighthouse <url> [--preset=desktop]`, categories performance, accessibility, best practices,
SEO. Lighthouse's Chrome renders WebGL on SwiftShader, so the page takes its software-renderer
path (poster, no autoplay): these numbers are the poster-first page.

| Page | Preset | Perf. | A11y | BP | SEO | FCP | LCP | TBT | CLS |
|---|---|---|---|---|---|---|---|---|---|
| Home | desktop | **100** | **100** | 100 | 100 | 0.4 s | 0.6 s | 0 ms | 0.045 |
| Home | mobile (Moto G Power, 4G, 4× CPU) | **98** | **100** | 100 | 100 | 1.6 s | 2.3 s | 40 ms | 0.007 |
| About | desktop | 100 | 100 | 100 | 100 | 0.5 s | 0.5 s | 0 ms | 0.007 |
| About | mobile | 95 | 100 | 100 | 100 | 2.4 s | 2.4 s | 0 ms | 0 |

Forcing the animation on the software renderer (`?lz-autoplay=force`, mobile preset): performance
65, TBT 23.6 s — software rasterization of every frame blocks the main thread. This is why the page
does not autoplay on SwiftShader / llvmpipe and why the frame-rate guard stops on the poster.

## 3D stage

Start-up, main-thread time per step (`performance.measure('lz:stage:*')`, SwiftShader, 1440 × 900):
import 36 ms, renderer 22 ms, model decode + illustrative data 35 ms, bricks/studs/plates 20 ms,
rest of the scene 31 ms, each of the 5 projected layers 11–19 ms, shader compile 45 ms (no
`KHR_parallel_shader_compile` in SwiftShader), first frame 4 ms. Every step yields to the main
thread; no start-up step is a long task on its own. Creating the WebGL 2 context for the probe
costs 0.75 s on SwiftShader and 0.9 s on llvmpipe (after `load`, not before first paint).

Per frame (instanced bricks, studs and plates; three shadow maps: room key 2048², two projector
spots 2048 × 1024 that skip their pass while off), measured with the previous home model (2,473
bricks); the synthetic district has 1,848 bricks and the same 15,360 studs, so brick triangles drop
by about a quarter and the draw calls do not change:

| t (s) | Scene | Draw calls (all passes) | Triangles (all passes) |
|---|---|---|---|
| 1, 25 | room, plates / bricks lifting | 19 | 0.43 M |
| 5, 8 | bricks dropping | 17 | 0.43 M |
| 12, 14 | projector on, layer crossfade / tram | 30 / 24 | 0.49 / 0.46 M |
| 19, 21 | figures, change layer, crossfade | 38 / 47 | 0.50 / 0.55 M |

The main pass draws at most 24 objects (SPEC §6.2: ≤ 60 draw calls); 15,360 studs (24 triangles
each, no shadow) are 0.37 M of the triangles. Frame rate: on SwiftShader at 1440 × 720 the guard
measured < 7 fps and stopped on the poster after ~3.5 s (llvmpipe: 1.4 fps, same outcome);
`?lz-autoplay=force` keeps the animation running (degraded) for tests and stills. **60 fps on an integrated GPU (SPEC §6.2) could not be measured here**; the quality
steps and the guard are the safety net until it is measured on real hardware.

## Loop (SPEC §10.1)

`e2e/home.spec.ts`: state and camera snapshots at t = 0, 28, 56, 84 s identical and rendered
pixels at 0, 28, 84 s identical; three accelerated cycles (8×): 0 caption/scene mismatches,
loop-time drift vs the monotonic clock 1.4e-14 s (1.8e-14 s on 2026-10-07). On SwiftShader a frame
can stall for 3.7–8.5 s, longer than one accelerated cycle (3.5 s), so counting the wraps seen
between samples failed about one run in five, on the original code as well; since 2026-10-07 the
test counts the seams crossed from the clock (≥ 3) and requires an observed wrap between every two
samples less than one cycle apart that straddle a seam (5/5 runs pass); three real-time cycles (85 s, `LZ_E2E_SLOW=1`):
0 mismatches, drift 1.4e-14 s, captions change at the same scene times every cycle.

# Create page (phase 2B)

Measured 2026-10-07 on the machine above (WSL2, no hardware GPU: Chromium renders WebGL on
SwiftShader), headless Chromium 1243 (Playwright 1.63), production build served by `vite preview`,
specs `e2e/create-perf.spec.ts` and `e2e/create-demo.spec.ts` run one at a time.

## SPEC G1 in the browser — 4 × 4 plates on 1.08 M triangles

Same dataset and area as the Node table above (Lyon 3 ×2 as one `.zip`, 4 × 4 plates at 3 m/stud
centred on 1844300, 5175100), uploaded through the file input, every step clicked by the test.
Four runs:

| Measure | Runs | What it includes |
|---|---|---|
| Import | 1.90 / 2.13 / 2.14 / 2.13 s | file input → *Continue* enabled: zip read, transfer to the Worker, unzip, b3dm/glTF parse, index, model summary |
| BVH build (Worker) | 1.29 / 1.20 / 1.12 s (not recorded in the first run) | built once, by the first ray query: the live estimate of step 2 |
| Generation, Legacy preset | 0.3 / 0.3 / 0.3 / 0.4 s | engine time shown by the page (*Generated in…*); BVH already built |
| Generation, Legacy + keep small | 0.8 / 0.6 / 0.6 / 0.8 s | next generation |
| Generation, True scale preset | 1.0 / 1.0 / 1.2 / 1.1 s | next generation (packing dominates, 6,495 bricks) |
| Click on *Generate* → result in the page | 0.4–2.6 s (Legacy), 1.2–2.4 s (others) | plus waiting behind the live estimates the test triggered seconds before, and main-thread work |
| Files chosen → first brick model shown | 5.0 / 7.0 / 6.7 / 6.0 s | the whole path with steps 2–3 typed by the test: import, plan raster and 3D preview of 1.08 M triangles, estimates with the BVH build, generation |

G1 ("generation … in < 5 s"): the generation itself takes 0.3–1.2 s, and 1.4–2.5 s if the BVH
build is counted with the first one. Browser times are about 1.5–2.5× the Node times above for the
import and the BVH, and close to them for generation. A mid-range laptop has not been measured.

## Demo path (SPEC §10.2), automated

Re-measured 2026-10-07 after the synthetic sample became the site's only demo (same machine,
`npx playwright test e2e/create-demo.spec.ts -g "all downloads" --workers=1 --repeat-each=3`).
`Try the sample` (1,416 triangles, 118 buildings) → default area (the whole sample, 3 × 3 plates
at 4 m per stud) → *Generate* (Legacy with small buildings kept, 672 bricks) → build guide →
BrickLink XML, Rebrickable CSV, one step done with Enter, CSV, PDF, LDraw, numbers compared across
all of them. Three runs:

| Demo loaded | Generated | Guide + all downloads | of which the PDF | Total |
|---|---|---|---|---|
| 0.65 s | 3.6 s | 13.9 s | 5.7 s (34 pages, 3.8 MB) | 18.1 s |
| 0.88 s | 4.6 s | 16.3 s | 6.0 s | 21.7 s |
| 0.97 s | 3.8 s | 16.6 s | 5.8 s | 21.4 s |

"Generated" runs from the demo loaded to the brick model shown, including the test's clicks
through steps 2 and 3 and their live estimates. The previous measurement (Part-Dieu demo, real
tiles, removed from the site) took 11.0–16.8 s. In the full parallel e2e run (8 workers sharing
SwiftShader) the same path took 48 s.

The target is 2 minutes for a first-time user; the usability test with people (`docs/usability-test-plan.md`) has
not been run.

## Bundle sizes (N5)

Same `vite build`, gzip -9:

| Loaded | Files | Raw | gzip |
|---|---|---|---|
| Create page, at load | `create` entry 161.4 kB + `shell` 173.1 kB (shared, includes every EN/FR catalogue) + 8 small shared chunks (dom, state, format, catalog, plates, types, preload helper, runtime) 14.3 kB | 348.9 kB | **103.8 kB** |
| CSS | `shell` 87.1 kB + `create` 16.6 kB (2026-10-07, after the shelf, viewport and bottom-bar fixes) | 103.7 kB | 19.3 kB |
| Engine Worker, first use | `engine.worker` (importers, BVH, heightmap, packing, exporters, calque, fflate, the parts of three it needs) | 275.1 kB | 89.2 kB |
| PDF, inside the Worker, first PDF (2026-10-07, site fonts) | `pdfGuide` (pdf-lib + guide layout + `pdfFonts`) 514.9 kB + `fontkit.es` (@pdf-lib/fontkit, its own chunk) 712.8 kB; then the font files (below) | 1,227.7 kB | **537.1 kB** (206.6 + 330.5) |
| PDF fonts, first PDF | latin `.woff2` of Plex Sans 400/600, Plex Mono 400/600, Bricolage (opsz) — the same hashed files as the CSS, so the page's cache may already hold them; latin-ext / Vietnamese / Cyrillic / Greek files only when the text needs them | 154.1 kB (already compressed) | — |
| First 3D view | `three.module` 556.0 kB (shared with the home page) + `three` (our view code) 36.6 kB | 592.6 kB | 146.3 kB |
| Build guide | `guide` 6.9 + `bricks` 21.0 + `build` 37.1 + `table` 8.5 + `downloads` 19.9 + `glyphs` 3.4 kB | 96.8 kB | 28.3 kB |
| Share dialog | `share` 4.8 + `qrcode` (core encoder only) 19.6 + `platePass` 10.8 kB | 35.2 kB | 14.8 kB |
| Plate mode (phone) | `plateMode` 3.8 kB + build guide modules as needed | — | — |

Three.js, the BVH, the importers and pdf-lib never load on the main thread before they are needed;
the Worker starts on the first engine request (import or demo). Before the site fonts (standard PDF
fonts), the PDF chunk was `pdfGuide` alone: 500.1 kB, 201.4 kB gzip; fontkit adds 330.5 kB gzip to
the first PDF (a prebuilt bundle: brotli and its dictionary, Unicode data, shapers; it cannot be
tree-shaken).

## PDF build guide with the site fonts (2026-10-07)

`node scripts/perf-pdf.ts --runs 4` renders the demo's guide in Node the way the Worker does (the
synthetic sample, 3 × 3 plates, 672 bricks, 34 A4 pages, EN). Before = the same script against the
previous `pdfGuide.ts` (standard fonts) from a clean copy of the repository, runs interleaved in
the same session, machine load average about 3:

| | First guide | Next guides | File |
|---|---|---|---|
| Standard fonts (before) | 3.47 / 3.61 s | 3.06–3.44 s | 3,715,268 bytes |
| Site fonts (after) | 3.76 / 4.09 s | 3.34–3.50 s | 3,757,567 bytes (+1.1 %) |

About +0.15 s per guide (+4 %), +0.3–0.5 s for the first one in the Worker's life (fontkit's module
evaluation, then loading and parsing the five latin files: 63 ms, 1 ms once cached; first text
layout 70 ms; latin-ext + Cyrillic files when needed: +42 ms). A rerun at load average 32 (the other
e2e suites running) gave the same picture: next guides 3.19–3.32 s before, 3.32–3.54 s after. The
six embedded subsets weigh 19.4 kB in the demo PDF plus 2.5 kB of ToUnicode maps; the rest of the
+42 kB is the two-byte glyph codes in the content streams. With a Latin-extended title and the FR
messages: 3,776,222 bytes (3,730,381 before, which printed "?ódz").

Demo path in the browser (same protocol as above, `--repeat-each=3`, US Letter, run on HEAD plus
this change while other suites shared the CPU, load average 2–12): PDF 4.5 / 5.0 / 4.9 s,
3,799,518 bytes, against 5.9 / 4.3 / 4.1 s and 3,757,249 bytes for HEAD in the same session — within
the noise of a shared machine.
