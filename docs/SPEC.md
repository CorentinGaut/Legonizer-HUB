# Legonizer website — Product specification

Version 1.2 — 2026-10-07 — Product owner: Corentin Gautier (corentin.gautier2@univ-lyon2.fr)
Status: approved for design and implementation. Decisions recorded in §12.

Sources:
- Paper: Le Bihan Gautier, Delanoy, Gesquière, JFIG 2024, hal-04924304 (https://hal.science/hal-04924304, CC0 1.0)
- Core algorithm: npm `legonizer@1.1.0` = https://github.com/VCityTeam/Legonizer commit `4239baa` (also a dev
  dependency, used by the parity tests)
- UD-Viz widget: `@ud-viz/widget_legonizer@4.6.1`
  (https://github.com/VCityTeam/UD-Viz/tree/master/packages/widget_legonizer)
- Online widget doc: https://vcityteam.github.io/UD-Viz/html/widget_legonizer/

---

## 1. Product vision

The Legonizer turns a 3D city model into a buildable model made of white bricks, for an **augmented tangible
model**: bricks on a table, a projector above them that projects urban data (building functions, green areas,
transport lines, changes over time), and a screen showing the 3D digital twin. Today the Legonizer only exists as a
widget inside UD-Viz, needs a hosted 3D Tiles dataset of Lyon, and outputs a raw CSV of stud heights.

The website makes it a self-service tool: anyone uploads their own 3D city data, picks an area and a scale, and gets
(a) the same height matrix as today and (b) everything needed to actually build it: the parts to buy, how to
assemble each baseplate, and the projection layer.

**One-line pitch:** *From a 3D city model to a brick model you can build, project on and discuss around.*

### Target users

| Persona | Goal | Skill |
|---------|------|-------|
| Workshop facilitator (urban mediation, museum, "maison du projet") | Build a physical model of a district for a public workshop | Not a GIS expert; has a 3D model file given by someone else |
| Researcher / GIS engineer (LIRIS, urban agency) | Produce a model of a precise area at a precise scale from 3D Tiles or CityGML-derived data | Expert; wants control over parameters and reproducibility |
| Teacher / student / maker | Learn about their city by building it | Beginner; wants a fun, guided path and a demo dataset |

## 2. The physical setup (ground truth for the home animation)

From the paper, §3.1 and Fig. 1, Fig. 3, Fig. 5:

- **Table**: 1 m wide × 2 m long, height adjustable, set at **0.60 m** so children can see the whole model.
- **Mast**: metal, **2.30 m** high, fixed on the side of the table.
- **Projector**: at the top of the mast, pointing down at the model; projects layers onto the **white** bricks.
- **Screen**: **31.5"** at **1.30 m** height on the mast; shows the 3D digital model and the timeline of versions.
- **Laptop** links projector and screen; a **wireless numeric keypad** switches layers/versions and is passed from
  participant to participant.
- **Model**: white bricks only (projection-friendly) on 32×32-stud baseplates.
- **Projected layers**: building functions, vegetation, public transport lines (Fig. 3, Gratte-Ciel, Villeurbanne);
  change layer with the colour code **green = construction, red = destruction, yellow = modification** (Fig. 5);
  multimedia (image + title) projected **next to** the model, not on it.
- The whole device is demountable and fits in a van (mobile mediation tool).
- Example models: a metallurgy factory (fine scale) and the Part-Dieu district in Lyon (coarse scale) (Fig. 2).

## 3. The current algorithm (parity reference)

Exact behaviour of UD-Viz 4.6.1 + legonizer 1.1.0. "Legacy mode" in this spec means reproducing **this**, bugs
included, except the filename bug (L8).

### 3.1 Pipeline

1. **Data**: 3D Tiles 1.0 (`tileset.json` + `.b3dm`) displayed in an iTowns `PlanarView`, projected CRS
   (EPSG:3946 for Lyon). Z is up, units are metres.
2. **Area**: a box (`boxSelector`, unit cube scaled) placed by drag on the map or by numeric inputs (position,
   rotation, scale). After a drag, its X/Y size is snapped down to `nPlates × scale × 32` m.
3. **Geometry** (`createMockUpObject`): for every batched feature whose batch table has a non-empty `gml_id` and
   whose world bounding box intersects the area's AABB, collect **all** features with that `gml_id` (whole
   features, not clipped), transform vertices to world coordinates, merge into one mesh, then translate it so that
   its **minimum z = 0**.
4. **Heightmap** (`createHeightMapFromBufferGeometry(geometry, area, xPlates, yPlates, maxLegoHeight)`):
   - `area` = AABB of the box after its world matrix (rotation included) is applied.
   - `step = (area.max.x − area.min.x) / 32 / xPlates` (the X step is also used for Y).
   - Grid of `32·yPlates` rows × `32·xPlates` columns; sample `(area.min.x + i·step, area.min.y + j·step)`
     (cell **corner**, not centre).
   - One ray per sample, from `z = maxZ` (max z of the merged geometry) in direction `(0,0,−1)`, three.js
     `Raycaster` against `new Mesh(geometry)` (default material, `FrontSide`); first hit → `h = maxZ − distance`,
     no hit → `0`.
   - Quantization: `ratioZ = maxZ / maxLegoHeight`; `value = Math.trunc(h / ratioZ)`, an integer in
     `[0, maxLegoHeight]`, unit = **one brick height**.
   - Memory layout: `heightMap[j][i]`, `j` = row along +Y (south→north), `i` = column along +X (west→east).
5. **Outputs**:
   - **CSV** (`generateCSVwithHeightMap`): rows written from `j = last` down to `0` (north first), values
     separated by `;`, each row terminated by `\n`, no header, no quoting needed (integers).
     Legacy filename `legoPlates_<x>_<y>.csv`.
   - **Projection layer** (`generateCadastre`): orthographic top view of the brick model, white background, black
     wireframe at 25 % opacity, long side 1920 px, downloaded automatically as `calqueTemplate.jpg`. The paper
     calls it the *calque* used to calibrate the projection.
   - **3D preview**: one box per non-zero cell, height `value × 1.230769` (9.6/7.8) in stud units, white, on a
     brown base.

### 3.2 Parameters exposed today

| UI label (legacy) | Variable | Default | Meaning |
|-------------------|----------|---------|---------|
| Coordinates › Position x,y,z | `boxSelector.position` | tile layer centre, z = 200 | Area centre (metres, CRS) |
| Coordinates › Rotation x,y,z | `boxSelector.rotation` | 0 | Radians — ignored by the heightmap (see L3) |
| Coordinates › Scale x,y,z | `boxSelector.scale` | 1 | Area size in metres |
| Scales Parameters › Scale | `scale` | 3 (field shows 0 until first frame) | **Metres per stud** (WIP "ratio") |
| Scales Parameters › Lego Max height | `legoHeight` | 10 | Bricks given to the tallest point |
| Scales Parameters › Count Lego x,y | `countLegoVec2Input` | derived | Number of 32×32 baseplates along X and Y |
| Select an area / Finish | — | — | Toggle drag-to-select mode |
| Generate Lego Mockup / Generate CSV Mockup | — | — | Run / download |

### 3.3 Known limitations of the legacy algorithm

| ID | Limitation | Consequence (counterexample) |
|----|------------|------------------------------|
| L1 | Vertical scale = `maxZ / maxLegoHeight`, independent of the horizontal scale | Area containing Incity (~200 m) with max height 10 → 1 brick ≈ 20 m and `trunc` sends every building under 20 m to 0: most of Part-Dieu disappears |
| L2 | `maxZ` and `minZ` come from whole features that merely touch the box | A tower just outside the area sets the vertical scale |
| L3 | Rotation is applied then discarded by taking the AABB | A rotated box selects a larger, axis-aligned area; output is not rotated |
| L4 | Terrain ignored; z = 0 is the lowest building base | On a slope (Fourvière, Croix-Rousse, ~100 m of relief) uphill buildings gain the hill's altitude |
| L5 | One ray per stud, at the cell corner | Aliasing; thin buildings missed or shifted by half a stud |
| L6 | Raycast against the whole mesh, no spatial index | 4×4 plates = 16,384 rays × all triangles: slow on real tiles (~45k triangles per Lyon tile) |
| L7 | Only features with `gml_id` are used | Any non-CityGML 3D Tiles or generic mesh produces an empty model |
| L8 | Filename uses `input.step` (always 1) instead of the value | File is always `legoPlates_1_1.csv` (bug: verified against `Vector2Input(label, step, value)`) |
| L9 | Y sampling uses the X step | If the box is not snapped (numeric scale edit), the grid does not cover the Y extent |
| L10 | The plate count is recomputed as `trunc(scale.x / scale / 32)` after the box is set | Float rounding loses a plate for 4.6 % of (scale, plates) pairs, e.g. 0.35 m/stud × 3 plates → 2 (found by the dev agent; the new engine uses the plate count as given) |

## 4. Scope

### In scope (v1)

- **Home page** (`/`): looping 3D animation of the setup with a use-case story, written description, link to the
  creation page.
- **Create page** (`/create`): import data → select area → set parameters → generate → explore the build guide →
  export.
- Processing **entirely in the browser** (static site, no backend; uploaded data never leaves the machine).
- English content, i18n-ready (French to follow).

### Out of scope (v1, candidates for later)

- Server-side conversion of raw CityGML (py3dtilers): documented as a preparation step instead.
- Projector calibration/keystone tool and the change-layer/timeline authoring of the paper (§4).
- Hollow interiors / structural optimization to reduce part count (v2 lever, see §7.4).
- Coloured bricks (the device is white-only by design).
- User accounts, cloud storage.

## 5. Information architecture

```
/                Home: animation, description, how it works, use case, credits, CTA "Create your model"
/create          Wizard: 1 Import · 2 Area · 3 Parameters · 4 Generate · 5 Build guide & export
/create#guide    Build guide: parts list · 3D instructions · downloads   (deep-linkable step)
/about (opt.)    Credits, paper citation, data preparation guide, licences, trademark notice
```

Global: header (logo, Create, About, language switch EN/FR), footer (paper citation, VCity/LIRIS credit,
trademark disclaimer, source code link).

## 6. Home page

### 6.1 Requirements

| ID | Requirement |
|----|-------------|
| H1 | Hero = full-width 3D animation of the setup (§2), playing as a seamless loop, with synced captions |
| H2 | The animation tells a **use case**: a public workshop on the evolution of a district (default: Part-Dieu, Lyon) |
| H3 | Proportions follow §2 (table 1×2 m at 0.60 m, mast 2.30 m, projector on top, 31.5" screen at 1.30 m) |
| H4 | The brick model in the animation is produced by **our own pipeline** (a heightmap fixture generated from the demo dataset), not a hand-made mesh |
| H5 | Written description: what the Legonizer is, why bricks + projection (collective, tangible, white for projection), how it works in 3 steps, who it is for |
| H6 | Primary CTA "Create your model" → `/create`, visible above the fold and after the description |
| H7 | Credits: authors, LIRIS / VCity, paper citation with HAL link, UD-Viz link |
| H8 | `prefers-reduced-motion`: static poster image + the caption list as text, no autoplay |
| H9 | Animation pauses when off-screen (IntersectionObserver) or tab hidden; user can pause/play (WCAG 2.2.2) |
| H10 | Poster image shown immediately; 3D starts after load (LCP must not wait for WebGL) |

### 6.2 Animation storyboard (baseline — UX may refine, keep the loop ≤ 30 s)

| # | Time | Scene | Caption (draft) |
|---|------|-------|-----------------|
| 0 | 0–3 s | Dim room, empty white table, mast with screen and projector, slow orbit | "A table, a projector, a screen." |
| 1 | 3–10 s | 32×32 baseplates slide in; white bricks drop **layer by layer** (the build order of §7.5) to form the district | "The Legonizer turns your 3D city into a brick plan." |
| 2 | 10–15 s | Projector turns on (light cone); building-function layer + tram lines projected onto the white bricks | "Project urban data onto the model." |
| 3 | 15–22 s | Screen shows the 3D timeline; projection switches to the change layer (green / red / yellow) with a multimedia card projected next to the model; small figures gather around the table | "Discuss how the district changed, together." |
| 4 | 22–26 s | Keypad press: layer switch; camera returns to the start pose; lights dim to the frame-0 state for a seamless loop | "Build yours." |

Technical: Three.js; bricks as `InstancedMesh` with studs; projector = `SpotLight` with a `map` texture
(projective texturing) and shadows; screen = video/canvas texture; deterministic timeline (no physics) so the loop
is exact; ≤ 60 draw calls; target 60 fps on an integrated GPU, degrade gracefully (lower DPR, no shadows).

### 6.3 Description content (outline)

1. What: "The Legonizer converts a 3D city model into a brick model of white bricks on 32×32 baseplates, ready to
   build, with its parts list, building instructions and projection layer."
2. Why: physical models are collective and tangible; digital models are dynamic. Augmented models combine both;
   white bricks make the model a projection screen; bricks make it modular, cheap, reusable, and playful.
3. How: (1) Import a 3D city model (2) Choose the area and the scale (3) Build it, project on it.
4. Who: workshop facilitators, urban planners, researchers, teachers, museums.
5. Use case: the Part-Dieu workshop (matches the animation).

## 7. Create page

Wizard with 5 steps, always-visible 3D viewport; every step can be revisited; state survives reload (IndexedDB)
and can be saved/loaded as a project file.

### 7.1 Step 1 — Import

| ID | Requirement |
|----|-------------|
| I1 | **3D Tiles 1.0** `.b3dm` tilesets: upload as `.zip` or as a folder (`webkitdirectory` / drag-and-drop of a folder); also a `tileset.json` URL when the server allows CORS |
| I2 | **3D Tiles 1.1** with glTF/GLB content: best effort (same pipeline) |
| I3 | **glTF / GLB** single files (Y-up → converted to Z-up) |
| I4 | **OBJ** (+ optional `.mtl`, ignored for geometry) |
| I5 | **CityJSON** 1.x (`transform` scale/translate applied; LoD choice: highest available ≤ 2.2 by default) |
| I6 | Unit and up-axis override for generic meshes (m / cm / mm / ft; Y-up / Z-up), with a sensible auto-detection and a visible summary (bounding box size in metres) so the user can spot a wrong unit |
| I7 | Georeferencing: ECEF tilesets (coordinates ~6.4e6 m from origin) are converted to a local ENU frame at the tileset centre; projected tilesets used as is; **py3dtilers tilesets** (per-tile `transform` to EPSG:3946 origins, see README) loaded consistently; world coordinates kept in float64 except in legacy mode, which reproduces UD-Viz's float32 rounding |
| I8 | Feature identity: use `gml_id` from the batch table when present (legacy grouping, §3.1 step 3); otherwise `_BATCHID`; otherwise one feature per mesh (fixes L7) |
| I9 | LOD: for tilesets with several levels, use the finest content (leaves for `REPLACE`, all contents for `ADD`) |
| I10 | **Demo datasets** bundled with the site (CORS blocks the LIRIS server): at least Part-Dieu (from Lyon 3 2018 tiles, decimated if needed, licence verified) and one small synthetic sample; one click "Try with Part-Dieu". Each demo has a manifest with a curated default area and **suggested settings**: Part-Dieu loads *Legacy + Keep small buildings*, with a visible note and a one-click switch to strict Legacy |
| I11 | Parsing in a Web Worker with progress, cancel, and clear errors (unsupported format, empty geometry, no features, too large, missing files referenced by `tileset.json`) |
| I12 | Size guidance: works up to ~2 M triangles / 300 MB on a mid-range laptop; above, warn and suggest cropping or decimation |
| I13 | A "Prepare your data" help page: CityGML → 3D Tiles with py3dtilers, OSM buildings → glTF, exporting from Blender/QGIS |

### 7.2 Step 2 — Area

| ID | Requirement |
|----|-------------|
| A1 | Top-down 2D/3D view of the imported model with a rectangle tool; the rectangle is **snapped to whole baseplates** (`nPlates × 32 × scale` metres) and shows the baseplate grid and labels |
| A2 | Numeric inputs: centre X/Y, plates X/Y, rotation (degrees); two-way binding with the rectangle |
| A3 | Default: the whole model if it fits in ≤ 4×4 plates at the default scale, else a centred 2×2-plate area |
| A4 | Rotation option `rotation: 'aabb' \| 'rotate'` (legacy = `aabb`, §3.1/L3); with `rotate` the sampling grid turns with the area. The engine returns the **effective sampled rectangle**, drawn dashed when it differs from the drawn one (L3, L9) |
| A5 | Live summary: physical size (cm), map scale (1 : scale/0.008, e.g. 3 m/stud → 1:375), number of studs, **"fits the Legonizer table"** check (1 × 2 m table → up to 3 × 7 baseplates of 25.6 cm, leaving room for projected multimedia) |
| A7 | **Scale** is one shared value, editable in step 2 (under Size) and step 3; changing it keeps plate count and centre, with a one-time hint offering to keep the ground area instead |
| A6 | Baseplate naming: columns **A, B, C…** west→east, rows **1, 2, 3…** north→south (A1 = north-west), same orientation as the CSV |

### 7.3 Step 3 — Parameters

**Legacy parameters** (§3.2, same names in a tooltip "UD-Viz name"):

| Parameter | Default | Range | Helper text (draft) |
|-----------|---------|-------|---------------------|
| Scale (metres per stud) | 3 | 0.25–50 | "One stud covers 3 m × 3 m of city. Map scale 1:375." |
| Max height (bricks) | 10 | 1–100 | Legacy mode: "The tallest building gets this many bricks." |
| Baseplates X × Y | from step 2 | 1–16 each | "Each baseplate is 32 × 32 studs (25.6 cm)." |

**Options** (an "Advanced" panel; a **"Legacy (UD-Viz 4.6.1)" preset** sets all of them to legacy values and is the
default, so the default output is identical to today):

| Option | Legacy value | Other values |
|--------|--------------|--------------|
| Height mode | `normalized` (L1, L2) | `true-scale`: bricks = h / (scale × 1.2) (brick 9.6 mm = 1.2 × stud pitch 8 mm; at 3 m/stud, 1 brick = 3.6 m ≈ one storey); `exaggerated`: true-scale × factor (0.5–5) |
| Height reference | lowest base of the selected features (L4) | `ground`: subtract terrain/ground height under each sample when a terrain or ground surfaces are available |
| Sampling | `corner-1` (L5) | `centre-1`; `supersample-N×N` (N = 2–4) with aggregate `max` / `mean` / `median` |
| Rounding | `trunc` | `round`, `ceil`; "keep small buildings" (any h > 0 → ≥ 1 brick) |
| Height cap | none | max bricks per column (for budget) |
| Feature selection | whole features touching the area (L2) | clip to the area |
| Acceleration | (invisible) | always BVH (`three-mesh-bvh`); must not change results |

Live feedback before generation: estimated max height in bricks and cm, studs count, and a warning when the legacy
normalized mode will erase buildings (share of features below one brick).

### 7.4 Step 4 — Generate & preview

| ID | Requirement |
|----|-------------|
| G1 | Generation runs in a Web Worker with progress and cancel; 4×4 plates on ~1 M triangles in < 5 s on a mid-range laptop (BVH) |
| G2 | 3D preview of the brick model (InstancedMesh, studs visible, baseplates grey, bricks white) with orbit controls, optional overlay of the source model (ghost) for comparison |
| G3 | Height histogram and per-plate summary (max height, brick count) |
| G4 | Changing a parameter marks the result stale; regeneration is one click |

### 7.5 Step 5 — Build guide & exports (the innovation)

The CSV says *how high* each stud is; the build guide says *which bricks to buy and where to put them*.

#### 7.5.1 Brick packing (core algorithm, new)

- Model: column `(i, j)` holds `H[j][i]` bricks. For each baseplate `P` and each layer `k = 1…Hmax`, the mask
  `M(P,k) = {(i,j) ∈ P : H[j][i] ≥ k}` must be covered exactly by rectangular bricks.
- Catalog (white, BrickLink colour 1 / Rebrickable colour 15 / LDraw colour 15) — part numbers to verify:
  `3005` 1×1, `3004` 1×2, `3622` 1×3, `3010` 1×4, `3009` 1×6, `3008` 1×8, `3003` 2×2, `3002` 2×3, `3001` 2×4,
  `2456` 2×6, `3007` 2×8; baseplate 32×32 (part to verify, e.g. `3811`).
- Constraints: exact cover, no overlap, both orientations allowed, **no brick crosses a baseplate boundary** (each
  baseplate is built and transported independently).
- Objective: (1) minimize the number of parts; (2) tie-break: maximize bricks bridging the seams of the layer below
  (running bond, model holds together). Deterministic output. Greedy + local improvement is acceptable;
  document the method and report the gap to a **valid** lower bound computed by the engine (`⌈area / 8⌉` is not one
  once 2×6 and 2×8 are enabled).
- User settings: enable/disable each part size except **1×1, which is always on** so exact cover always exists; max part length.
- **Plate-local**: the packing of plate P depends only on the heights inside P, the part settings and the algorithm
  version (the running-bond tie-break looks only at P's lower layers). Required by the plate passes (O10).
- Output: list of placed bricks `{plate, layer, x, y, w, d, rotation, partId}` + counts per part, per plate, total.

#### 7.5.2 Outputs

| ID | Output | Requirement |
|----|--------|-------------|
| O1 | **CSV matrix** | Byte-identical to legacy in legacy mode (§3.1 step 5); filename `legoPlates_<X>_<Y>.csv` with the actual plate counts (fixes L8); option: one CSV per baseplate |
| O2 | **Projection layer (calque)** | Legacy JPG (1920 px long side, `calqueTemplate.jpg`) + PNG at a chosen DPI with real physical size in metadata, optional plate grid and labels; used to calibrate the projector |
| O3 | **Parts list** | Visual list with a brick glyph per part (drawn to scale, stud count visible), quantity, part number; totals; per-baseplate breakdown; respects inventory settings |
| O4 | **Interactive 3D instructions** | One baseplate at a time, layer by layer; previous layers ghosted, new bricks highlighted; per-step callout of the parts used ("this step: 4× 2×4, 2× 1×2"), like an official booklet; keyboard navigation (arrows **and numeric keypad**, a nod to the device's keypad); progress "Plate B2 · layer 3/9"; deep link to a plate and layer |
| O5 | **Printable PDF** | Cover with plate layout map (A1…); per baseplate: colour-coded height grid with the number in each stud, parts list, one diagram per layer (top view, new bricks outlined); the projection layer page; generated client-side; A4 and US Letter |
| O6 | **BrickLink wanted list** | XML `<INVENTORY><ITEM><ITEMTYPE>P</ITEMTYPE><ITEMID>…</ITEMID><COLOR>1</COLOR><MINQTY>…</MINQTY></ITEM>…` including baseplates |
| O7 | **Rebrickable CSV** | `Part,Color,Quantity` with colour 15 |
| O8 | **LDraw model** | `.ldr` (MPD optional, one submodel per baseplate) openable in BrickLink Studio / LeoCAD: 1 stud = 20 LDU, brick height 24 LDU, −Y up, colour 15 |
| O10 | **Plate passes** | One printable card per baseplate (kit list + QR code). The QR opens that plate's 3D instructions on any phone with no server: plate heights, part settings and app version ride in the URL **fragment** (run-length + deflate + base64url); above a scannability size threshold the pass prints without QR |
| O9 | **Project file** | `.legonizer.json`: input file names + hashes, area, parameters, app version, heightmap; re-importable to regenerate identical outputs |

## 8. Non-functional requirements

| ID | Requirement |
|----|-------------|
| N1 | Static site, no backend; deployable on GitHub Pages; no data leaves the browser (state it on the import step) |
| N2 | Browsers: latest 2 versions of Chrome, Edge, Firefox, Safari; WebGL 2 for 3D views. Without WebGL 2 the wizard still works in **2D mode** (numeric area, generation, height grid, parts list, 2D layer diagrams, all exports) |
| N3 | Accessibility: WCAG 2.2 AA; every 3D view has a non-3D equivalent (height grid table, parts list, captions); full keyboard operation of the wizard and instructions |
| N4 | Responsive: home fully responsive from 360 px; create page desktop/tablet first (≥ 768 px), on phones the build guide (instructions, parts list) remains usable |
| N5 | Performance: home LCP < 2.5 s on 4G (poster first), home JS ≤ 300 kB gzip before the 3D chunk; heavy code (loaders, BVH, PDF) lazy-loaded on `/create` |
| N6 | i18n: all strings in locale files; EN complete, FR keys present |
| N7 | Reproducibility: same inputs + parameters + app version → identical CSV and parts list |
| N8 | Quality: unit tests for parsers, heightmap, packing, exporters; **parity tests** against `legonizer@1.1.0` on fixtures; property tests for packing (exact cover, no overlap, no boundary crossing); e2e smoke test of the wizard with the demo dataset |
| N9 | Trademark: LEGO® is a trademark of the LEGO Group, which does not sponsor, authorize or endorse this site — disclaimer in the footer; body text says "bricks", never uses LEGO logos or trade dress |
| N10 | Licences: credit upstream (legonizer ISC, UD-Viz LGPL-2.1), paper (CC0), data (Métropole de Lyon open data) on the About page |

## 9. Technical architecture (binding for implementation)

- **Build**: Vite multi-page app (`index.html`, `create.html`, `about.html`), TypeScript strict, ES2022.
- **3D**: Three.js (latest stable), `three-mesh-bvh` for raycasting; loaders: `GLTFLoader`, `OBJLoader`; b3dm parsed
  by a small in-house parser (header, feature table, batch table, embedded GLB) or `3d-tiles-renderer` loaders —
  choose and justify; CityJSON parsed in-house.
- **No UI framework required**; if one is used, justify it in the README. Styling via the design tokens
  (`src/styles/tokens.css`).
- **Core engine** (`src/core/`) is framework-free, DOM-free, runs in a Worker and in Node (tests):
  `import/` (parsers → normalized `CityMesh`: Z-up metres, feature ids), `heightmap/` (legacy + options),
  `packing/`, `export/` (csv, calque, bricklink, rebrickable, ldraw, pdf, project).
- **Tests**: Vitest (+ fast-check for properties), Playwright for e2e. Parity tests install `legonizer@1.1.0` as a
  dev dependency and compare matrices exactly.
- **Node**: v26 via nvm in this WSL environment (`source ~/.nvm/nvm.sh`); the `npm` on the default PATH is the
  Windows one and must not be used.

### 9.1 Data contracts

```ts
type HeightMap = { cols: number; rows: number; data: Int32Array }   // data[j*cols + i], j south→north, i west→east
type Params = {
  scale: number; maxHeight: number; platesX: number; platesY: number;
  heightMode: 'normalized' | 'true-scale' | 'exaggerated'; exaggeration?: number;
  heightRef: 'lowest-base' | 'ground'; sampling: 'corner-1' | 'centre-1' | `supersample-${2|3|4}`;
  aggregate?: 'max' | 'mean' | 'median'; rounding: 'trunc' | 'round' | 'ceil'; keepSmall: boolean;
  cap?: number; selection: 'touching' | 'clip'; rotation: 'aabb' | 'rotate';
}
type Area = { cx: number; cy: number; rotationDeg: number }          // size derived from plates × 32 × scale
// The heightmap result also returns the effective sampled rectangle (A4).
type PlacedBrick = { plate: string; layer: number; x: number; y: number; w: number; d: number; partId: string }
```

## 10. Acceptance criteria (v1 done when)

1. Home: animation loops seamlessly ≥ 3 cycles without drift, reduced-motion fallback works, CTA reaches `/create`.
2. Demo path: "Try with Part-Dieu" → default area → Generate → CSV + parts list + instructions + PDF + BrickLink +
   LDraw downloads, in under 2 minutes for a first-time user (usability test T1 in `docs/usability-test-plan.md`).
3. Legacy parity: on ≥ 3 fixtures (synthetic boxes, a sloped scene, a real Lyon tile) the legacy-mode matrix equals
   `legonizer@1.1.0` output cell for cell, and the CSV is byte-identical.
4. Packing: property tests pass (exact cover, no overlap, no crossing, determinism); part count reported vs lower
   bound.
5. Imports: one fixture per format (b3dm zip, b3dm folder, GLB, OBJ, CityJSON) loads and generates.
6. Lighthouse (home): Performance ≥ 90, Accessibility ≥ 95.
7. LDraw file opens in LeoCAD (manual check, screenshot in the PR).

## 11. Deliverables and roles

| Agent | Definition | Output |
|-------|------------|--------|
| UX expert | `.claude/agents/legonizer-ux.md` | Flows, wireframes, interaction specs, microcopy (now `src/i18n/`), home storyboard, usability test plan (`docs/usability-test-plan.md`) |
| UI expert | `.claude/agents/legonizer-ui.md` | Design tokens, type, colour (light/dark, projection palette), components (now `src/styles/`), 3D look, print layout |
| Implementation expert | `.claude/agents/legonizer-dev.md` | The site (repo root), tests, README, deployment workflow |

Order: UX and the core engine (dev, phase 1) in parallel → UI (from UX) → dev phase 2 (pages from UX + UI).

## 12. Decisions log

| Date | Decision |
|------|----------|
| 2026-10-06 | Inputs: 3D Tiles + glTF/GLB + OBJ + CityJSON, parsed in the browser; no backend; raw CityGML via documented py3dtilers preparation |
| 2026-10-06 | Algorithm: legacy parity by default (preset "Legacy (UD-Viz 4.6.1)"), improvements as opt-in options; filename bug fixed |
| 2026-10-06 | Build guide: optimized parts list + interactive 3D instructions + printable PDF per baseplate + BrickLink/Rebrickable/LDraw exports |
| 2026-10-06 | Three expert agents defined in `.claude/agents/` and run UX → UI → dev |
| 2026-10-06 | Defaults (not discussed, changeable): English first with i18n, Vite + TypeScript + Three.js, GitHub Pages |
| 2026-10-06 | Demo datasets carry suggested settings (Part-Dieu = Legacy + Keep small buildings); Legacy stays the default for user data |
| 2026-10-06 | Scale shared between steps 2 and 3 (A7) |
| 2026-10-06 | 1×1 bricks always enabled, exact cover guaranteed |
| 2026-10-06 | Plate passes with QR in v1 (O10); packing is plate-local |
| 2026-10-06 | Fonts self-hosted (@fontsource, OFL), no request to Google Fonts. Change layer keeps green/red/yellow semantics with colour-blind-safe values `#14B391` / `#B42330` / `#FBE04B` (VCity team may override). White baseplates (3811, white) by default in shop lists; preview grey unless White is chosen. The demo preset reads "Legacy (UD-Viz 4.6.1) with small buildings kept" instead of a bare "Custom" |
| 2026-10-06 | ⌈area/8⌉ is not a lower bound once 2×6/2×8 are enabled; the engine reports its valid bound, the microcopy must not say "at least ⌈area/8⌉" |
| 2026-10-06 | `rotation: 'aabb' \| 'rotate'` parameter + effective sampled rectangle returned; 2D mode without WebGL 2 |

## 13. Open questions (non-blocking)

1. **Name**: "Legonizer" contains the LEGO trademark. Keep it (research tool name) or rename the public site
   (e.g. "Brickonizer", "CityBricks")? Owner: VCity team.
2. **Demo data licence**: confirm the Métropole de Lyon 3D buildings licence allows redistributing a tile subset.
3. **Hosting**: GitHub Pages under VCityTeam or a lab domain?
4. **Site licence**: LGPL-2.1 to match UD-Viz, or another?
5. **Part numbers**: confirm the catalog in §7.5.1 and the 32×32 white baseplate reference on BrickLink.
6. **Function layer in greyscale**: the six building-function colours stay distinct for colour-blind viewers but
   not in greyscale; printed or monochrome uses need labels or patterns. Owner: VCity team.
7. **Home animation content**: projected uses, tram lines, changes and media cards are illustrative (the site says
   so). Real changes between two Lyon dataset years and rights-cleared media would replace them. Owner: VCity team.
8. **Older Safari**: colours use `light-dark()` (Safari ≥ 17.5). Schools with older iPads would need a build-time
   fallback.
9. **v1.1 candidates**: custom table size (A5 assumes 1 × 2 m); subtract bricks already owned (Rebrickable CSV) from
   the shop lists; split very large layers into 16 × 16 sub-steps; build progress in the project file; several
   models in one project (v1 imports one).
10. **Accepted limits**: no progress sync between devices (no backend); no prices, affiliate links or store accounts.

### Engineering follow-ups

- PDF uses the standard PDF fonts; embedding the site fonts needs `@pdf-lib/fontkit`.
- Shared CSS bugs worked around in the create page: `.lz-logo__mark` needs `flex-shrink: 0`; `.lz-option > legend`
  overrides `.lz-visually-hidden`; `.lz-tablefit text` overflows its viewBox; the shelf tray is narrower than the
  2×8 glyph; the viewport's 18rem minimum height with a 4:3 ratio is wider than a phone.
- On phones, "Show as list", "Copy link" and the `.mpd` radio sit partly under the sticky bars (excluded from the
  axe `target-size` check in `e2e/create-helpers.ts`).
- A local build made after `npm run fixtures:demo -- --public` includes the Part-Dieu demo in `dist/`; add a guard
  while the licence (item 2) is open.
- Data-preparation help: point to py3dtiles (py3dtilers is unmaintained since January 2025).
- Manual checks: open the LDraw file in LeoCAD (§10.7); run the usability test (`docs/usability-test-plan.md`);
  measure frame rate and generation time on a real laptop and phone GPU.
