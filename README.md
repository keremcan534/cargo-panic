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

TypeScript + Vite + **Three.js** for the world, plain **HTML/CSS** for every
piece of UI. No backend, no accounts, no network calls, no external assets -
every texture is drawn into a canvas at boot and every sound is synthesised
with the Web Audio API.

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

The warehouse, rack, cargo and belt are a real 3D scene rendered by Three.js.
The HUD, balance meter, panels and menus are DOM. Splitting it that way gives
crisp text at any pixel ratio, native touch targets and CSS transitions for
free, while the world gets PBR materials, real shadows and post-processing.

**2.5D, on purpose.** The camera is a 40 degree perspective camera pitched 22
degrees down, so the slot grid stays a flat, readable plane facing the player -
the puzzle is still "which slot", never "aim in 3D" - but planks have depth,
cargo has volume, and the belt sits in front of the rack instead of below it.

**Framing is solved, not tuned.** [`frameCamera`](src/render/three/Framing.ts)
iterates camera distance and height against three screen-space constraints: the
rack fits the width with a margin, its cap beam stays below the HUD band, and
the belt's front edge is pinned to the same screen height on every level so the
pickup spot never moves. The module is pure and Node-importable; the same maths
drives the headless regression harness that plays the game with synthetic
pointer input.

**Look.** Hemisphere, key and rim lights plus three flickering spot lamps with
soft shadow maps; ACES tone mapping, exponential fog and a light bloom pass;
`MeshStandardMaterial` cargo whose front faces (type art, weight badge, crack
overlay on damaged fragile crates) are canvas textures; a pooled point cloud
for dust, sparks, glass and confetti. Bloom switches itself off after about
1.5 seconds of sustained slow frames, so a low-end phone keeps its frame rate
before it keeps its glow.

Measured in a CPU-throttled headless Chrome at DPR 3 (1170 x 2532 backing store)
on a three-tier level while dragging a package:

| CPU throttle | fps | p95 frame |
| --- | --- | --- |
| 1x | 144 (vsync) | 7.3 ms |
| 4x (mid-range phone) | 144 | 7.5 ms |
| 6x (low-end) | 113 | 10.0 ms |

CPU throttling does not slow the GPU, so these numbers bound the JavaScript
side only; on a weak mobile GPU the shadow maps and bloom are the cost, which is
why bloom is the first thing the adaptive path drops. The Three.js chunk is
122 KB gzipped, under a third of the previous Phaser bundle.

---

## Input

Cargo is picked by ray-casting the pointer against the live belt package and
every stowed package, then dragged along a fixed plane just in front of the
rack. The drop slot comes from the dragged box's position in rack-local space,
so a leaning rack is handled for free. One `pointerdown / move / up` path on the
canvas serves mouse and touch identically; on touch the package floats 0.9
world units above the finger so it stays visible. Every button is a DOM element
with a 52px minimum target.

---

## Progress and settings

`localStorage` under `cargo-panic.save.v1`: unlocked level, stars per level,
best balance per level, best endless score and wave, sound and vibration
toggles. Saves written before Endless existed load fine. If storage is unavailable
(private mode, blocked cookies) the game silently falls back to an in-memory
save so play is never interrupted.

---

## Layout

The UI is laid out in CSS (safe-area aware) and the 3D framing adapts to any
aspect ratio through the solver above, so tall Android phones and tablets both
get a full-width rack. Browser scrolling, pinch-zoom, double-tap zoom, text
selection and the long-press context menu are all suppressed.

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
  main.ts                  boots the saved view (2D or 3D) through the StageHost; gesture lockdown
  app/
    App.ts                 StageHost + the single FrameLoop + Router; view switching, context-loss fallback
    StageHost.ts           owns the one Stage, the only writer of loop.stage; serialised switches
    FrameLoop.ts           the only requestAnimationFrame loop
    Router.ts              one stage, one UI root, one screen at a time
    Game.ts                gameplay controller: GameSession, HUD/panels, audio, win/fail, endless
    PauseReasons.ts        why the session is paused (menu, legend, switching, hidden, context-lost)
  input/
    InteractionController.ts  pointer state machine -> session commands + view calls
  render/
    GameView.ts, Stage.ts  renderer contracts (no three.js)
    createStage.ts         makes a Stage; the ONLY (dynamic) import of the 3D renderer, 2D fallback
    quality.ts             3D quality profiles (auto / low / high) and the adaptive ladder
    hero.ts                the title screen's hero rack, shared by both renderers
    layout.ts              screen bands and slot hit-testing shared by every renderer
    Tween.ts               tween runner
    art/                   canvas artwork for cargo faces and shelf labels
    canvas2d/              the Canvas 2D renderer: stage, game view, backdrops, particles
    three/                 everything that imports three.js (loaded only when 3D is chosen):
      ThreeStage.ts        WebGL renderer, camera, post chain, particles, shake, picking
      ThreeGameView.ts     the 3D game view (drag, landings, spills, dispatch, confetti)
      backdrops.ts         menu and level-select scenes
      Framing.ts           camera framing solver
      Materials.ts         PBR materials from the canvas artwork
      Warehouse.ts, Particles.ts, world/{Rack3D,Shelf3D,Cargo3D,Conveyor3D}
  ui/                      DOM: Hud, Meter, Panels, Menu, LevelSelect, Splash, ViewSettings, Notice
  game/
    config.ts              tuning constants and world proportions
    session/               GameSession: the pure rules state and commands
    systems/               Balance, Placement, Hazard, Solver, Rng, RunManager,
                           Audio, Haptics, Hint gate, Progress
    levels/                campaign data, package specs, endless generator
scripts/
  validate-levels.ts       campaign QA gate
  validate-endless.ts      procedural generation QA gate
```

One `Game` controller runs both modes: Endless simply feeds it generated
`LevelDef`s and wraps them in a run. Nothing in the placement, balance or
hazard code knows which mode it is in. The controller never touches three.js:
it drives a `GameSession` with semantic commands and tells the stage's
`GameView` what happened.

`BalanceSystem`, `Solver`, `Framing` and the level data import no DOM, which is
what lets the validators and the regression harness run them in Node.

---

## Hints

Free, and structured so they need not stay that way. `requestHint()` in
[`src/game/systems/HintService.ts`](src/game/systems/HintService.ts) runs
through a swappable gate; calling `setHintGate()` once at startup is enough to
put a rewarded video in front of it without touching gameplay code.
