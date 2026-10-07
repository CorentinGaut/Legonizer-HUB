# Usability test plan

Version 1.1 — 2026-10-07 (the synthetic sample replaces the Part-Dieu demo, SPEC §12) — covers SPEC §10.2 ("a first-time user gets from the demo to all downloads in under
2 minutes, usability test scenario") and the riskiest design decisions of the create page and the build guide.

## 1. Goals

| # | Question | Design element | Spec / issue |
|---|----------|----------------|--------------|
| G1 | Can a first-time user go from the home page to all build-guide downloads with the demo in under 2 minutes? | Demo CTA, wizard defaults, build guide tabs | §10.2, I10 |
| G2 | Do people notice a wrong unit or axis after importing their own model, and can they fix it? | Import summary, size check | I6, I11 |
| G3 | Can people choose an area that fits the table, and do they understand plates, scale and the fit check? | Area rectangle, two-way binding, table diagram | A1–A7 |
| G4 | Do people notice that buildings disappear in legacy mode, understand why, and fix it? Do they notice a stale result? | Live estimates, warning with fixes, stale banner | §7.3, L1, G4, I10 |
| G5 | Can a group use the build guide at the table: read quantities, navigate with the keypad, hand a plate to a team, prepare an order? | Brick shelf, Build view, keypad mapping, plate pass, BrickLink card | O3, O4, O6, O10 |
| G6 | After a short look, do people understand what the site is for? | Home hero and description | H1–H5 |

## 2. Method

- **Moderated, think-aloud**, one participant at a time, 60 minutes, in person (T5 needs a keypad, a phone and
  bricks). T1–T4 can also run remotely with screen sharing.
- **Prototype**: the implemented site on a staging build.
- **Device**: a mid-range laptop (the reference machine of SPEC G1 and `docs/perf.md`), latest Chrome, 1440 × 900
  window; a mid-range phone for T5; a wireless numeric keypad.
- **Recording**: screen + audio, with consent; a stopwatch for timed tasks; an observer takes notes on the sheet in
  §6.

## 3. Participants

| Persona (SPEC §1) | Number | Screening |
|-------------------|--------|-----------|
| A — Workshop facilitator (mediation, museum, *maison du projet*) | 3 | Runs or prepares public workshops; not a GIS specialist |
| B — GIS researcher / engineer | 2 | Works with 3D Tiles or CityGML; at least one has used the UD-Viz Legonizer widget |
| C — Teacher, student or maker | 2 | No GIS training; comfortable with a laptop and a phone |

- **First-time users** for T1: no prior use of this site (the UD-Viz widget does not count).
- **Accessibility session** (separate, recommended): one keyboard-only participant and one screen reader user on
  T1 and T5 (adapted: navigate with the keyboard and the text twins of the 3D views).
- Seven participants are enough to find most recurring problems of this flow; this plan does not aim at
  statistical claims. Times are reported per participant, not averaged into benchmarks.

## 4. Session outline

| Time | Part |
|------|------|
| 0–5 min | Consent, background questions (role, 3D city data experience, brick building experience, workshop practice) |
| 5–7 min | **W0 — first look** (G6): show the home page for 10 seconds with the animation playing, then hide it. Ask: *"What does this website do? Who is it for?"* |
| 7–12 min | T1 |
| 12–20 min | T2 |
| 20–30 min | T3 |
| 30–40 min | T4 |
| 40–55 min | T5 |
| 55–60 min | Debrief (§7) |

After each task: Single Ease Question (*"Overall, how easy or difficult was this task?"* 1 = very difficult,
7 = very easy).

## 5. Tasks

### T1 — Demo path in under 2 minutes (SPEC §10.2)

| Item | Content |
|------|---------|
| Goal | G1 |
| Start state | Home page, fresh browser profile (no saved project), 1440 px window |
| Scenario (read aloud, then hand over the card) | *"You're preparing a workshop about a district. A colleague told you this website can help. Using its sample, get everything on this card."* |
| Card | 1. See the list of bricks to buy · 2. See the building instructions · 3. Download the printable guide (PDF) · 4. Download the shopping list for BrickLink · 5. Download the 3D model for LDraw · 6. Download the height file (CSV) |
| Success | All 6 items done (downloads individually or with *Download everything*), without assistance, in **≤ 2:00** from the first click on the home page |
| Pass rule for v1 (proposed) | At least 6 of 7 participants succeed within 2:00; any failure is analysed for its cause before release |
| Observe | Entry point used (*Try the sample* on home or the demo card on Import); whether they keep the default area; hesitation on *Scale & height*; **whether they notice the "buildings disappear" warning without prompting** (record only, do not prompt; feeds the T4 decision rule); waiting time for generation and PDF (note the system time separately); whether *Copy XML* vs *Download .xml* confuses; whether they find *All downloads* |
| Metrics | Time to each item; total time; assists; wrong turns; SEQ |
| Spec | §10.2, I10, G1, O1, O3–O6, O8 |

### T2 — Own model with a wrong unit

| Item | Content |
|------|---------|
| Goal | G2 |
| Start state | Create page, step 1, empty |
| Fixture | `district-cm-zup.obj`: a district of about 1.5 × 1 km exported **in centimetres** with **Z up** (so read as metres it is about 150 km wide, and with an OBJ's usual Y-up assumption the buildings lie on their side) |
| Scenario | *"A GIS colleague sent you this file of a district. Load it and check it's ready before you choose an area."* (No mention of units.) |
| Success | Unit set to centimetres and the model upright (Z up), summary showing about 1.5 × 1 km, before moving to step 2; ≤ 3 min; no assistance. If auto-detection already gets the axis right, record it and score the unit only |
| Observe | Do they read the summary card? Do they see the *"Is the unit right?"* notice? Do they connect a huge size with a unit problem? Can they tell from the 3D preview that buildings lie on their side? Do they find *Up axis*? Do they look for help (*Prepare your data*)? |
| Metrics | Success, time, assists, SEQ; a comprehension question: *"How big is this district in reality?"* |
| Spec | I4, I6, I11 |

### T3 — An area that fits the table

| Item | Content |
|------|---------|
| Goal | G3 |
| Start state | Sample loaded, step 2 with the default area (3 × 3 plates), scale 4 m per stud |
| Scenario, part A | *"For your workshop you want the area around the tall tower, as big as possible while still fitting on the Legonizer table with room for projected pictures. Keep the current scale."* |
| Success A | The tower is inside the area; plates = 3 × 7 or 7 × 3; the table check says it fits; ≤ 3 min |
| Scenario, part B | *"A colleague sends you exact coordinates for the centre: X = [value], Y = [value]. Put the area there."* (values prepared from the demo dataset) |
| Success B | Centre fields equal the given values; the rectangle moved accordingly; ≤ 1 min |
| Variant for persona B, part C | *"Rotate the area by 30 degrees. What will the model cover?"* Success: explains the dashed box (legacy samples the unrotated bounding box) or switches to *Rotate with the area* |
| Observe | Dragging vs numbers; understanding of snapping by whole plates (do they expect free sizes?); do they read the table diagram and its orientation (*lengthwise*)?; do they try to change the scale instead (A7); confusion between plates west–east and north–south; whether the plate labels A1… make sense |
| Metrics | Success per part, time, assists, SEQ; question: *"How big will this be on the table?"* (answer in cm) |
| Spec | A1–A7 |

### T4 — Missing buildings and an out-of-date result

| Item | Content |
|------|---------|
| Goal | G4 |
| Start state | Sample generated with the strict Legacy preset (*Switch to Legacy*) and the default area; step 4 result showing a "buildings disappeared" warning |
| Scenario | *"At a rehearsal, someone says: 'My building is missing, the small one near the tower.' Make sure every building appears, and get an up-to-date build guide."* |
| Success | Applies a fix (*Keep small buildings*, *Use true scale* or a higher max height), regenerates, and reaches the build guide with no "disappeared" warning; ≤ 3 min; no assistance |
| Probe before regenerating | *"What do you expect to change?"* |
| Comprehension question after | *"Why were those buildings missing?"* Correct if it mentions that one brick stood for a large height (or the max height / the tallest building setting the scale) |
| Observe | Path to the fix (*Fix* link in step 4 vs going back to step 3); reading of *"1 brick = 9.6 m"* and *"2 times flatter"* (the sample at 4 m per stud); whether they notice the stale banner and the disabled downloads; whether *Undo changes* is understood; whether *Legacy* is perceived as "the right one" or "the old one" |
| Variant for persona B | *"Save this project, reload the page, open the project file, and check the CSV is identical."* Success: same CSV bytes (moderator compares) |
| Metrics | Success, time, assists, SEQ, comprehension score |
| Spec | §7.3 live feedback, L1, G4, O9, N7, I10 |

### T5 — The build guide at the table

| Item | Content |
|------|---------|
| Goal | G5 |
| Start state | Build guide of the sample (3 × 3 plates), *Get the bricks* tab; numeric keypad connected (run once with Num Lock on and once off across participants); a phone on the table; a baseplate and a few bricks for show |
| Part A — quantities | *"How many 2×4 bricks do you need for the whole model? And for plate B1 only?"* Success: both numbers correct, ≤ 1 min |
| Part B — keypad | *"Using only the numeric keypad, show your team layer 3 of plate B1. Then turn the view so it matches the side of the table you're standing on."* Success: B1 layer 3 reached and view turned, keypad only, ≤ 2 min |
| Part C — hand over a plate | *"Another team only has this phone. Give them plate A2 so they can start building."* Success: the phone shows plate A2 in Plate mode (QR or link), ≤ 2 min |
| Part D — order | *"Prepare the order on BrickLink, as if you were going to buy the bricks."* Success: copies or downloads the XML, opens BrickLink's upload page and explains the paste step; ≤ 2 min (no purchase, no login required) |
| Observe | Do they read the shelf glyphs or the numbers? Do they find the scope switch *Plate B1*? Keypad: do they discover the key hints, try 4/6 naturally, confuse 8/2 (view) with layers? Plate naming A1/B1 vs rows/columns; stud rulers used?; QR found under *Share this plate*?; Plate mode banner understood ("nothing uploaded")?; BrickLink paste flow clear? |
| Metrics | Success per part, time, assists, SEQ; keypad errors (wrong key presses) |
| Spec | O3, O4, O6, O10, §7.5.1 |

## 6. Observation sheet (one per participant and task)

| Field | Notes |
|-------|-------|
| Participant / persona / task | |
| Start, end, total time | |
| Outcome | Success · Success with assist · Fail · Gave up |
| Assists (what and when) | |
| Path taken (screens, controls) | |
| Hesitations > 5 s (where) | |
| Errors (wrong control, wrong value, misread) | |
| Quotes | |
| SEQ (1–7) | |
| Issues found → severity (0–4) → linked OI | |

Severity scale: 0 not a problem · 1 cosmetic · 2 minor (slows down) · 3 major (fails without help or wrong
result) · 4 blocker (cannot complete, or would build a wrong model).

## 7. Debrief questions

1. *"In one sentence, what would you tell a colleague this site does?"* (compare with W0)
2. *"What was the most confusing moment?"*
3. *"Would you trust the shopping list enough to order the bricks? Why or why not?"*
4. *"Which of the files would you actually use, and for what?"*
5. Persona A and C: *"Would you run a workshop with this? What's missing?"* Persona B: *"Would you use the Legacy
   preset or the other options for your work? Why?"*

## 8. Analysis and decision rules

- Findings are grouped by step and rated with the severity scale; each links to a SPEC requirement or becomes a new
  open question in SPEC §13.
- **Decision rules** (proposed, agreed with the PO before testing):
  - T1: if the pass rule fails, fix the causes before release (it is an acceptance criterion, §10.2).
  - T4: if at least 2 of the 3 facilitators do not notice the warning in T1, or fail T4, take the demo and
    default settings (I10, SPEC §12) back to the PO with the recordings.
  - T3 (A7): if participants look for the scale in step 2 or are surprised that it changes the area, keep the
    shared Scale control; if not, consider moving Scale back to step 3 only.
  - T5: if the keypad mapping causes repeated wrong presses (more than 3 in Part B for more than half of
    participants), revisit the mapping of 8/2 and 5.
- Report: one page of top findings with clips, the observation sheets, and the new open questions for SPEC §13.

## 9. Preparation checklist

- [ ] Staging build (the sample demo is bundled) and the `district-cm-zup.obj` fixture
- [ ] Prepared coordinates for T3 part B; prepared generated state for T4 and T5 (project files)
- [ ] Fresh browser profile per participant (no saved project, downloads folder emptied)
- [ ] Wireless numeric keypad, phone with a QR reader, baseplate and a few bricks
- [ ] Consent form; recordings stored on the lab's storage only, deleted after analysis
- [ ] Pilot session with one internal person to check timings and wording
