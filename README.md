# Cargo Panic

A mobile-first casual puzzle game by **BlackBlue Studios**.

> Pack the warehouse without tipping the shelves.

**[Play it here](https://keremcan534.github.io/cargo-panic/)**

Packages arrive on a conveyor. Drag them onto the rack. Every crate pushes the
rack sideways with `weight × distance from the middle × tier multiplier`, and if
the two sides drift too far apart the whole thing goes over.

Two modes: a **25-level campaign**, and an **endless shift** of procedurally
generated waves where every rack is proved solvable before you ever see it.

---

## Running it

```bash
npm install
```

```bash
npm run dev
```

Then open the URL Vite prints (http://localhost:5173 by default).

Production build:

```bash
npm run build
```

Serve the build locally:

```bash
npm run preview
```

Level QA (proves every hand-authored level is solvable — see below):

```bash
npm run validate
```

Endless QA (sweeps thousands of generated waves — see below):

```bash
npm run validate:endless
```

---

## Stack

TypeScript + Vite + Phaser 3. No backend, no accounts, no network calls, no
external assets — every sprite is drawn into a canvas texture at boot and every
sound is synthesised with the Web Audio API.

---

## How the balance model works

There is **no physics simulation**. Everything is deterministic arithmetic, so
the same arrangement always produces the same result.

```
torque(package) = weight × (offset from rack centre, in slots) × tierLeverage
tierLeverage    = 1 + tierIndex × 0.25     // tier 0 is the bottom shelf
net             = rightTorque − leftTorque
imbalance       = |net|
```

The meter reads green below half tolerance, yellow up to tolerance, red above
it. While dragging, a ghost needle previews exactly where the drop will leave
the rack — the player always sees the consequence before committing.

### Nothing fails instantly

Three conditions can lose a level, and all three behave identically: a red
banner appears with a visible countdown, and the timer refills the moment the
player fixes the problem. Cargo can always be picked back up and moved, or
dragged down to the belt to re-queue it.

| Hazard | Trigger | Grace |
| --- | --- | --- |
| `RACK COLLAPSED` | imbalance over tolerance (drains 2× past 1.75×) | 3.0s |
| `SHELF OVERLOADED` | shelf weight over its load rating | 3.0s |
| `FRAGILE CARGO DAMAGED` | weight ≥ 4 in the column above a fragile crate | 3.5s |

Genuinely impossible drops (no room, sealed shelf, priority cargo outside its
gold zone) are refused at drop time with a toast instead, and cost a star tier
rather than the level.

### Cargo

| Type | Weight | Slots | Rule |
| --- | --- | --- | --- |
| Standard box | 2 | 1 | — |
| Heavy crate | 5 | 1 | crushes fragile cargo below it |
| Fragile crate | 1 | 1 | its column must stay clear of heavy cargo |
| Long package | 3 | 3 | eats three slots |
| Priority package | 2 | 1 | must finish inside a gold zone |

Fragile columns are drawn as translucent vertical bands so the crush rule is
never a hidden trap. Each shelf shows its tier multiplier and a live load bar.

### Stars

- **3** — no rejected drops, no hint, and a finishing imbalance within 40% of the level's limit
- **2** — cleared cleanly, or cleared with the hint
- **1** — cleared after three or more rejected drops

---

## Levels

25 hand-authored levels in [`src/game/levels/levels.ts`](src/game/levels/levels.ts).
Levels are pure data — no level-specific code exists anywhere in the gameplay
logic.

```ts
{
  id: 7,
  name: 'CRATE RUN',
  objective: 'Land three heavy crates safely',
  tip: 'The bottom shelf only takes 12. One crate has to go up.',
  shelves: [
    { slots: 7, maxWeight: 12 },              // index 0 = BOTTOM tier
    { slots: 5, maxWeight: 10 },
  ],
  packages: ['heavy', 'heavy', 'standard', 'heavy', 'standard'],
  balanceTolerance: 5,
  // optional: finalBalanceMax, shelf.locked, shelf.zone
}
```

Progression: 1–3 drag and balance · 4–7 heavy crates and tiers · 8–11 fragile
columns · 12–15 long packages and space · 16–19 load limits and gold zones ·
20–23 everything combined · 24–25 the hard ones.

### `npm run validate`

A headless checker that, for every level, brute-forces the placement space and
proves:

1. the manifest physically fits (slots and weight capacity),
2. a legal finishing arrangement exists inside the balance limit,
3. a three-star finish is reachable, and
4. there is a path that places cargo **in conveyor order** without the rack ever
   going red — so no level ever *requires* burning a grace period.

The same solver powers the in-game hint button, so a level that validates is a
level the hint can always answer.

---

## Endless Shift

An endless run is a sequence of generated waves. Clear the manifest and the
shipment is dispatched, the rack empties, and a harder wave rolls in. One hazard
timer running out ends the run — there are no lives, which makes the grace
periods the real currency of the mode.

**Every wave is proved before it ships.** The generator rolls a rack and a
manifest, then hands it to the same solver the hint button uses, which must find
a way to stow the whole manifest *in conveyor order* without the rack ever going
red. Candidates that fail are rerolled with progressively looser constraints. A
sweep of 1,350+ waves finds zero that need the safety fallback.

The curve, all in [`specFor`](src/game/levels/generator.ts):

| Wave | What changes |
| --- | --- |
| 1 | 2 tiers, 3 plain boxes, red line 7.0 |
| 2 / 4 / 6 / 9 | heavy · fragile · long · priority cargo joins |
| 5 / 10 | a third, then a fourth tier |
| 12 | shelves can be sealed off |
| ~15 | manifest tops out at 11 packages |
| ~23 | red line bottoms out at 3.0 |
| 12 → 35 | **grace periods shrink from 3.0s to 1.5s** |

That last row is what keeps the mode escalating after the other knobs bottom
out, and it costs the solver nothing.

Scoring is per shipment: cargo weight, a wave multiplier, a sliding balance
bonus, plus bonuses for finishing dead level and for a wave with no rejected
drops or hints. Best score and best wave are saved locally.

Waves are deterministic from `(seed, wave)`, so a run is reproducible. The
results screen shows the run's seed, and `?seed=12345` replays that exact shift.
Generation for the next wave is prefetched while you play the current one, so
the search never costs a frame.

---

## Rendering

The game is authored in a fixed **720-wide logical space**, but that is not what
it renders at. A phone at `devicePixelRatio` 3 gives the canvas roughly 1236
real pixels across, so drawing at 720 and letting the browser stretch the result
blurred every sprite and label by about 70%.

So three things line up on the same scale:

| | before | after |
| --- | --- | --- |
| canvas backing store | 720 x 1580 | **matches physical pixels** (1236 x 2712 on a DPR-3 phone) |
| baked textures | 1x | **2x**, drawn back down |
| `Phaser.Text` | 1x | **rasterised at the render scale** |

Cameras are zoomed by the same factor
([`useLogicalCamera`](src/game/render.ts)), so scene code — including
`pointer.worldX` — still works in plain 720-wide units and never has to think
about it. Text resolution is applied by listening for `ADDED_TO_SCENE` rather
than remembering it at forty call sites.

On top of that the main camera carries a cheap **ColorMatrix grade and
vignette** (single-pass shaders on the existing render target), the warehouse is
built in depth layers with real light pooling, and cargo carries edge occlusion
and a grounded base so the flat front faces read as volume.

Measured on a CPU-throttled Chrome at DPR 3, full resolution and post-processing:

| CPU throttle | fps | p95 frame |
| --- | --- | --- |
| 1x | 144 (vsync) | 7.3 ms |
| 4x (mid-range phone) | **63** | 17.1 ms |
| 6x (low-end) | 38 | 28.1 ms |

The post-processing costs about 1.4 fps of that — the engine is nowhere near
being the limit, which is why the fix here was resolution and art direction
rather than a different renderer.

---

## Input

Both cargo dragging and every button hit-test themselves from scene-level
pointer events rather than going through Phaser's per-object input, because
per-object hit testing does not fire for touch pointers in this project. One
code path therefore serves mouse and touch identically. Buttons keep a 52px
minimum touch target however small they are drawn, and a dragged package floats
64px above a finger so it stays visible while being moved.

---

## Progress and settings

`localStorage` under `cargo-panic.save.v1`: unlocked level, stars per level,
best balance per level, best endless score and wave, sound and vibration
toggles. Saves written before Endless existed load fine. If storage is unavailable
(private mode, blocked cookies) the game silently falls back to an in-memory
save so play is never interrupted.

---

## Layout

The stage is a fixed 720 logical pixels wide with a height that follows the
device aspect ratio (clamped to 1120–1580), so tall Android phones fill their
screen instead of being letterboxed. Short racks scale up to fill the available
band. Browser scrolling, pinch-zoom, double-tap zoom, text selection and the
long-press context menu are all suppressed.

---

## Wrapping for Google Play

The build is Capacitor-ready: `base: './'` in the Vite config so it works from
`file://` inside a WebView, and [`capacitor.config.json`](capacitor.config.json)
is already filled in.

```bash
npm install @capacitor/core @capacitor/cli @capacitor/android
npx cap add android
npm run build && npx cap sync
npx cap open android
```

Lock the activity to `portrait` in `AndroidManifest.xml`.

The web build is also deployed to GitHub Pages by
[`.github/workflows/deploy.yml`](.github/workflows/deploy.yml) on every push to
`main`. Both QA gates run before the deploy step, so a build only reaches Pages
if every campaign level and a 1,600-wave generator sweep still pass.

Haptics currently go through `navigator.vibrate`
([`src/game/systems/Haptics.ts`](src/game/systems/Haptics.ts)); swapping in
`@capacitor/haptics` means editing only that file.

---

## Project layout

```
src/
  main.ts                  Phaser boot, browser gesture lockdown, resize handling
  game/
    config.ts              tuning constants
    layout.ts              responsive anchors (Phaser-free, shared with tooling)
    render.ts              render scale, logical camera, camera grade
    textures.ts            every sprite, drawn into canvas textures at boot
    scenes/                Boot, Splash, Menu, LevelSelect, Game
    systems/               Balance, Placement, Hazard, Solver, Rng, RunManager,
                           Audio, Effects, Haptics, Hint gate, Progress
    entities/              Package, Shelf, Rack, Conveyor
    levels/                campaign data, package specs, endless generator
    ui/                    Button, TapManager, BalanceMeter, Hud, Panels, Backdrop
scripts/
  validate-levels.ts       campaign QA gate
  validate-endless.ts      procedural generation QA gate
```

One `GameScene` runs both modes: Endless simply feeds it generated `LevelDef`s
and wraps them in a run. Nothing in the placement, balance or hazard code knows
which mode it is in.

`BalanceSystem`, `Solver`, `layout` and the level data import no Phaser, which
is what lets the validator run them headlessly in Node.

---

## Hints

Free, and structured so they need not stay that way. `requestHint()` in
[`src/game/systems/HintService.ts`](src/game/systems/HintService.ts) runs
through a swappable gate; calling `setHintGate()` once at startup is enough to
put a rewarded video in front of it without touching gameplay code.
