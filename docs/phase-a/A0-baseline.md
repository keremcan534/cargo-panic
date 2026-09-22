# A0 — Baseline and test infrastructure

Recorded 2026-09-22 before any Phase A gameplay change.

## Starting point

| | |
| --- | --- |
| Branch | `claude/cargo-panic-product-plan-o520h6` (same commit as `main`) |
| Commit | `506ba05bfb4b0d25c244a67e1cabe04a5bf8c2ab` — matches the plan's reference commit |
| Working tree | clean, no user changes to preserve |
| Node / npm | v22.22.2 / 10.9.7 |

## Commands run on the untouched commit

| Command | Result |
| --- | --- |
| `npm ci` | OK, 28 packages, 0 vulnerabilities |
| `npm run build` (`tsc --noEmit && vite build`) | OK. `index` chunk 113.6 kB (36.7 kB gz), `three` chunk 483.8 kB (121.6 kB gz) |
| `npm run validate` | OK — 25/25 levels solvable, 3-star reachable, conveyor-order path exists |
| `npm run validate:endless -- 40 40` (the CI sweep) | OK — 1,600 waves, 0 fallbacks, avg 13.2 ms, worst 468 ms |
| `npm run validate:endless` (default 120 × 40) | OK — 4,800 waves, 0 fallbacks, avg 14.0 ms, worst 605 ms, 95 s wall |

Generation times are from this cloud container's CPU under Node, not from a
phone. The 468–605 ms worst case is a single wave; in the game it runs as a
prefetch 120 ms after a wave starts, on the main thread. Whether that causes a
visible hitch on a real phone is **not measured**; a Worker is only justified
once it is.

No pre-existing failures.

## Test infrastructure added

| Command | What it runs |
| --- | --- |
| `npm test` | `node --import tsx --test "tests/unit/**/*.test.ts"` — Node's built-in runner, no new dependency (`tsx` was already a dev dependency) |
| `npm run test:e2e` | Playwright against `vite build` + `vite preview`, headless Chromium, Pixel 7 viewport with touch |
| `npm run baseline` | regenerates `tests/fixtures/baseline.json` |

`@playwright/test` is pinned to exactly `1.56.1`, the version whose Chromium
build (`chromium-1194`) is preinstalled in this environment; no browser
download happens. The lockfile change is additions only.

Headless Chromium renders WebGL through SwiftShader. E2E tests are functional
checks; they say nothing about frame rate on a device.

### What the first tests cover

- `tests/unit/baseline.test.ts` — golden snapshot of campaign levels 1, 8, 15
  and 25 and of Endless seed `12345` waves 1, 10 and 25: rack, manifest,
  tolerance, empty-board evaluation, the solver's first hint, a proved
  conveyor-order solution, grace scale, generator attempts and the scoring of
  three sample waves. Verified to fail when the fixture is altered.
- `tests/unit/architecture.test.ts` — the balance, placement, hazard, solver,
  run and level modules must not reach `three` or DOM globals through runtime
  imports (`import type` and dynamic `import()` are not followed).
- `tests/e2e/smoke.spec.ts` — splash → menu → level 1 with HUD and canvas.

## three.js import chain (before)

Every screen reaches three.js statically, so today the 2D requirement ("no
WebGL on a 2D start") is impossible without restructuring:

```
src/main.ts -> src/render/Renderer.ts -> three (+ EffectComposer, RenderPass, UnrealBloomPass, OutputPass)
src/main.ts -> src/ui/Splash.ts -> src/ui/Menu.ts -> three
src/app/Game.ts -> three
src/ui/LevelSelect.ts -> three
```

Modules that import three directly: `render/{Renderer,Framing,Materials,Particles,Warehouse}`,
`world/{Rack3D,Shelf3D,Cargo3D,Conveyor3D}`, `app/Game`, `ui/{Menu,LevelSelect}`.
Already pure: `game/systems/{Balance,Placement,Hazard,Solver,RunManager,Rng,HintService}`,
`game/levels/*`, `game/config`, `ui/{Hud,Meter,Panels,dom}`, `app/Router` (type-only).

## Persistent save fields (`localStorage["cargo-panic.save.v1"]`)

| Field | Type | Meaning |
| --- | --- | --- |
| `unlocked` | number 1–25 | highest unlocked level |
| `stars` | `{ [levelId]: 0–3 }` | best stars per level |
| `bestBalance` | `{ [levelId]: number }` | lowest finishing imbalance per level |
| `sound` | boolean | sound toggle |
| `haptics` | boolean | vibration toggle |
| `endless` | `{ bestScore, bestWave, runs }` | Endless records (absent in pre-Endless saves) |

Unavailable storage falls back to an in-memory save **silently**; a failed write
flips to in-memory **silently**. There is no backup, no version field inside
the payload, and no active-run persistence.

## State to move into the pure core (A1)

From `src/app/Game.ts` (`GameController`): the queue (`queue`), the board
(`PlacementSystem`), the hazard clocks (`HazardSystem`), the phase machine
(`play`/`paused`/`resolving`), win settling (`winAccum`, `canFinish`,
`blockingReason`), assists (`hintUsed`, `mistakes`), star calculation
(`winLevel`), wave scoring (`clearWave` → `scoreWave`), the failure detail
text (`failLevel`), and the Endless wave intro. `seedFromUrl` in
`RunManager.ts` touches `window` and belongs in a platform module.

## Plan claims checked against the code

| Plan says | Code says |
| --- | --- |
| Invalid drop does `mistakes++` | Confirmed, `Game.ts` `onPointerUp`. Mistakes cap stars (0 → 3★ possible, ≥1 → max 2★, ≥3 → 1★) and cancel Endless "NO FUMBLES" |
| Picking cargo up is only visual | **Not so.** `beginDrag` calls `board.remove()` for stowed cargo and `queue.shift()` for belt cargo. Holding a crate off a red rack changes the evaluated board, so it can pause or refill a hazard timer. A1 fixes this |
| Endless grace floor 1.5 s | Confirmed: `graceScale` clamps to 0.5 from wave 35 (balance/overload 1.5 s, fragile 1.75 s) |
| Only three.js as a runtime dependency | Confirmed. No Capacitor packages installed and no `android/` project; only `capacitor.config.json` exists. Android is not ready |
| DPR cap and bloom drop on slow frames | Confirmed: `MAX_DPR = 2`; bloom off after ~90 slow frames (>26 ms) |
| Hint gate for a future ad | Confirmed (`HintService.setHintGate`), no ad SDK anywhere |
| 1,600-wave check | Confirmed as the CI invocation (`-- 40 40`); the default is 4,800 |
| No `npm test` | Confirmed; added in A0 |

Also found:

- GPU resources are only partly released between screens. `Rack3D.dispose`,
  `Warehouse.dispose` and `Conveyor3D.dispose` detach groups without disposing
  geometries or materials, and `Rack3D.updateCrushColumns` clones a material on
  every board refresh without disposing it. Harmless for one screen, but it
  is a leak that grows with every level, and view switching (A2) needs real
  cleanup.
- The README's performance table is a CPU-throttled desktop headless Chrome
  run. It is not a phone measurement and is not repeated here.
