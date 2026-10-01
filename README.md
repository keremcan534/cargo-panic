# Cargo Panic

A mobile-first casual puzzle game by **BlackBlue Studios**.

> Pack the warehouse without tipping the shelves.

**[Play it here](https://keremcan534.github.io/cargo-panic/)**

Packages arrive on a conveyor. Drag them onto the rack (or tap one, then tap a
slot). Every crate pushes the
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
it. While a target is shown - under a dragged package, or under the finger
after tapping a package - a ghost needle previews exactly where that move will
leave the rack, and a ghost outlines every cell the package would take. The
player always sees the consequence before committing.

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
gold zone, a long package that does not fully fit) are refused with a toast
that says why. Nothing changes on the rack and they cost nothing: no star,
no score, no bonus.

When a level is lost, the panel says what really happened - e.g. "The top
shelf carried 14 against a rating of 12." - and the rack points at the shelf
or crates involved. No "so close!" copy.

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

Ruleset 2 (the current one):

- **3** — no hint, and a finishing imbalance within 40% of the level's limit
- **2** — any other finish, including one where the hint was used

Refused drops never cost a star (they are input slips, not strategy), and the
undo never caps stars. Stars earned under ruleset 1 are kept; they are never
lowered.

### Undo

One free undo per shipment (a campaign level or an Endless wave): it takes
the rack and the belt back to before the last committed move. It does not
refund a hazard countdown that was already running, cannot be used twice,
and is marked as help used on the results (Endless: an ASSISTED RUN). The
level-cleared panel lists the help taken: NONE, HINT, UNDO or HINT + UNDO.

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
bonus, plus bonuses for finishing dead level and for a wave with no help used
(no hint, no undo). Refused drops cost nothing. Best score and best wave are
saved locally, per ruleset; a best from an older ruleset is shown apart as
"previous rules".

When a run ends, RETRY SAME SHIFT replays the same seed from wave 1 (a new
run, so nothing from the old one is paid again) and NEW SHIFT deals a fresh
seed.

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
with a 48px minimum target.

A press becomes a drag after 8 px of travel (4 px after a 180 ms hold). A
press released before that is a **tap**: it selects the package (the rack
does not change). With a package selected, putting a finger on a slot shows
the target and the balance preview while the finger is down; lifting it there
commits the move, lifting it elsewhere does nothing. Drag and tap end in the
same session command and validator (`src/input/InteractionController.ts`), so
how a package was moved can never change the rules. One finger at a time: a
second finger cannot steal, aim or drop; a cancelled touch, a lost pointer or
the app going to the background puts the package back without changing the
board.

---

## Progress and settings

`localStorage` under `cargo-panic.save.v2` (checksummed; the previous good
write is kept as `.bak`; see `src/game/save`). A v1 save is migrated once and
left in place, with a copy under `cargo-panic.save.v1.backup`: stars, best
balance, unlocks, sound, vibration and the Endless best (shown apart as a
previous-rules record). A damaged save is restored from the backup; if that
fails too it is set aside under `cargo-panic.save.corrupt` and a new one
starts - the player is told either way. A save from a newer version is never
overwritten. If storage is blocked or a write fails, play goes on from memory
and the game says progress cannot be saved.

The game in progress is saved too: the level or Endless shift, the rack, the
belt, the hazard clocks, help used and the undo right - at every committed
move, pause and resume, when the app goes to the background and when leaving
for a menu, never per frame. The menu then offers CONTINUE (so does the
level select's button when the saved game is the campaign's next level;
otherwise it reads PLAY LEVEL N and starts fresh): the game comes back
paused, nothing moved, and only RESUME starts the clocks - and shows the
opening notes, which could not be read under the panel. An Endless
wave's reward, the move to the next wave and the saved shift are one write,
so a reload cannot pay a wave twice. When the tab is hidden or the app goes
to the background the game pauses ("Paused while you were away"), sound stops
and the save is written; the time away is never charged. In the game,
Escape (like the Android back button) acknowledges a save message on screen
first, else opens or closes the pause panel. In the Android app the same
paths run from the Capacitor App plugin's app state and back button events
(`src/platform/lifecycle.ts`; on the bare title screen back exits the app).
The web lifecycle is tested in the browser; the native wiring only against a
fake plugin in the browser, not yet on a device.

Settings (main menu gear, and the pause panel): VIEW 2D / 3D, 3D QUALITY,
REDUCED MOTION (system / on / off: no camera shake, rack wobble or pulsing,
softer glow, token particles; hazards stay as text, icon and countdown) and
LANGUAGE (a button naming the language in force that opens the list: SYSTEM
and the ten languages below, each written in itself). All text lives in
`src/i18n`. Levels 1-3 carry a short, skippable guide; REPLAY TUTORIAL in
settings shows it again.

---

## Languages

| Code | Picker name | Number locale | Source |
| --- | --- | --- | --- |
| `en` | English | en-GB | original |
| `tr` | Türkçe | tr-TR | shipped with the game (not part of this machine-translation batch) |
| `de` | Deutsch | de-DE | machine translation, needs native review |
| `es` | Español | es-ES | machine translation, needs native review |
| `fr` | Français | fr-FR | machine translation, needs native review |
| `it` | Italiano | it-IT | machine translation, needs native review |
| `pl` | Polski | pl-PL | machine translation, needs native review |
| `pt` | Português (Brasil) | pt-BR | machine translation, needs native review |
| `ru` | Русский | ru-RU | machine translation, needs native review |
| `id` | Bahasa Indonesia | id-ID | machine translation, needs native review |

See [docs/TRANSLATIONS.md](docs/TRANSLATIONS.md) for the review status and
each language's glossary of game terms.

- **Which language.** The save's `settings.language` holds the player's pick,
  or `null` for SYSTEM: the first of the device's languages the game speaks
  (`navigator.languages`, matched by base: `pt-PT` and `pt-BR` -> `pt`,
  older Android's `in` -> `id`), else English. `src/i18n/languages.ts` has the
  codes, names, locales and the tag matching; the save sanitiser keeps only
  those codes.
- **Applying it.** `applyLanguage()` sets the text dictionary and
  `<html lang>`, so CSS `text-transform: uppercase` and `hyphens: auto` follow
  the language's rules (Turkish i -> İ). A pick applies at once: the screen
  re-renders in the new language.
- **Numbers.** `fmt()` writes decimals with the language's separator
  (3.5 / 3,5) and `formatScore()` groups digits its way (12,480 / 12.480 /
  12 480).
- **Fit.** `tests/e2e/languages.spec.ts` opens the menu, settings with the
  language list, level select, a HUD with a hazard banner, the pause, loss
  and win panels in every language at 360 x 640 and 412 x 915 and fails if a
  text box or button label overflows; screenshots go to
  `test-results/languages/`.

### Adding a language

1. Add its code, its own name, its number locale (and any extra device tags)
   to `src/i18n/languages.ts`.
2. Copy `src/i18n/en.ts` to `src/i18n/<code>.ts` as
   `export const <code>: Record<TextKey, string> = { ... }` and translate
   every value. The type makes a missing or extra key a compile error. Keep
   every `{placeholder}`, keep all-caps copy all-caps (written upper-cased in
   the language's own case rules), keep `\n` line breaks, and list the game
   terms you chose (shelf, rack, cargo, heavy / fragile / long / priority,
   Endless Shift, undo, hint) in the file's header.
3. Register the dictionary in `DICTS` in `src/i18n/index.ts` (and in the
   unit and e2e tests' dictionary maps).
4. Run `npm test` (keys, placeholders, casing, line breaks, number formats)
   and `npx playwright test tests/e2e/languages.spec.ts`, then look at the
   language's screenshots in `test-results/languages/` - fix overflow with
   CSS or a shorter wording, never by changing the English meaning.
5. Mark it in docs/TRANSLATIONS.md (machine translation until a native
   speaker has reviewed it).

---

## Layout

The UI is laid out in CSS (safe-area aware) and the 3D framing adapts to any
aspect ratio through the solver above, so tall Android phones and tablets both
get a full-width rack. Browser scrolling, pinch-zoom, double-tap zoom, text
selection and the long-press context menu are all suppressed.

---

## Wrapping for Google Play

The Android app is a Capacitor 8 shell around the web build, in
[`android/`](android/) (generated by `npx cap add android`, then adjusted as
listed below; committed). `appId` (`com.keremcan534.cargopanic`), the
name and `webDir` come from [`capacitor.config.json`](capacitor.config.json);
`base: './'` in the Vite config lets the build load inside the WebView.

Building needs JDK 21 and the Android SDK (platform `android-36`, build-tools
35; `ANDROID_HOME` set, or `sdk.dir` in `android/local.properties`, which is
ignored). Gradle itself comes from the wrapper.

```bash
npm ci
npm run android                          # npm run build && npx cap sync android -> android/app/src/main/assets/public (ignored)
cd android
./gradlew assembleDebug                  # app/build/outputs/apk/debug/app-debug.apk (signed with the shared debug key)
./gradlew bundleRelease                  # app/build/outputs/bundle/release/app-release.aab (unsigned without the upload key)
```

`npx cap open android` (from the repository root) opens the project in Android Studio.

Run `npm run android` (or `npx cap sync android` after a build) before every
Gradle build; the APK/AAB carry whatever `dist/` held at the last sync.

**Maven Central answering HTTP 429.** Central sometimes refuses busy
networks and CI runners. [`scripts/gradle/maven-mirror.init.gradle`](scripts/gradle/maven-mirror.init.gradle)
is a Gradle init script that points every `mavenCentral()` repository at
Google's mirror of it (`https://maven-central.storage-download.googleapis.com/maven2/`)
without changing the project; `google()` is untouched. Both CI workflows use
it; locally, from `android/`:

```bash
./gradlew --init-script ../scripts/gradle/maven-mirror.init.gradle assembleDebug
```

(or copy it into `~/.gradle/init.d/` for every build on that machine).

What the Android project sets:

- **Package id `com.keremcan534.cargopanic`** (`appId` in
  `capacitor.config.json`, `namespace` and `applicationId` in
  `android/app/build.gradle`, `MainActivity`'s package). It is the app's
  permanent identity on Google Play: do not change it after the first upload.
- **Full screen**: `MainActivity` hides the status and navigation bars (a
  swipe from the edge shows them for a moment, and they hide again by
  themselves; hidden again whenever the game regains focus) and keeps the
  screen on while the game is in front. With the bars hidden only a display
  cutout is left: the page uses `viewport-fit=cover` and the CSS adds
  `env(safe-area-inset-top/bottom)` to the HUD, menu and panel offsets.
- **Portrait only** (`android:screenOrientation="portrait"` on the activity),
  and `android:appCategory="game"`, which is what exempts a game from Android
  16's rule that large screens ignore orientation locks.
- **No white flash**: the launch theme uses the game's background `#0d1117`
  (Android 12+ system splash with the launcher icon; older versions draw
  `res/drawable/splash.xml`, the same colour with the mark), the app theme's
  window is dark, and `capacitor.config.json` gives the WebView the same
  background.
- **Version**: `versionName` is read from `package.json`; `versionCode` from
  the environment variable `CARGO_PANIC_VERSION_CODE` (1 without it). CI
  numbers debug APKs by the CI run (`github.run_number`), release bundles by
  main's commit count (`git rev-list --count HEAD`), so each upload to Play is
  higher than the last.
- **No native libraries** (`.so`): the app is Java/Kotlin and the WebView, so
  the 64-bit and 16 KB page-size rules need nothing.
- **Launcher icons** from the game's mark: `npm run store:android-icons`
  ([`marketing/android-icons.ts`](marketing/android-icons.ts)) renders the
  legacy square and round icons (48 dp, mdpi-xxxhdpi) and the adaptive layers
  (108 dp foreground with the mark inside the 66 dp safe zone, the store
  icon's dark gradient as background, a monochrome layer for themed icons)
  into `android/app/src/main/res/mipmap-*`, plus a preview sheet at
  `marketing/out/android-icons-preview.png`. Re-run it if the mark changes.
- **Lifecycle and back button** through `@capacitor/app` (loaded only inside
  the native shell, by dynamic import, so the web entry chunk does not carry
  it): going to the background and coming back pause and report like a hidden
  tab, and back goes to `App.back()` (a save message first, then the screen:
  panels, pause); unhandled on the title screen, the app exits.
- **Recovery from an unexpected error** ([`src/app/recovery.ts`](src/app/recovery.ts)):
  an uncaught error or unhandled rejection from the game's own code (and
  anything a frame callback throws: the frame loop keeps running) is logged
  once, the save is written, and the player is taken back to the main menu
  with "Something went wrong. The game recovered and your progress is safe."
  The game in progress stays resumable (CONTINUE). Errors from browser
  extensions or other origins are ignored. After 3 recoveries within 10
  seconds the notice is shown once more and the game stays on the menu.
- **Ads: off.** See [Ads (off)](#ads-off).

**Signing.**

- *Debug builds* are signed with `android/app/debug.keystore` (alias
  `androiddebugkey`, passwords `android`), committed on purpose: every debug
  APK, from CI or any machine, installs over the previous one and keeps the
  saved game. That key is public, so it must never sign a release (the build
  never uses it for one). Every other `*.jks` / `*.keystore` and
  `keystore.properties` is ignored by git.
- *Release builds* are signed with the Play **upload key** only when these
  environment variables are set (a partial set stops the build with a
  message); without them `bundleRelease` gives an unsigned bundle:
  `CARGO_PANIC_KEYSTORE_FILE` (path to the `.jks`), `CARGO_PANIC_KEYSTORE_PASSWORD`,
  `CARGO_PANIC_KEY_ALIAS`, `CARGO_PANIC_KEY_PASSWORD`.
- With Play App Signing, Google holds the app signing key; the upload key
  stays with the owner, outside the repository, with its passwords in a
  password manager. Create it once:
  `keytool -genkeypair -v -keystore cargo-panic-upload.jks -alias upload -keyalg RSA -keysize 4096 -validity 10000`
  (a JDK 21 keystore is PKCS12: the key's password is the keystore's).

**Release workflow** ([`.github/workflows/release.yml`](.github/workflows/release.yml),
"Release bundle"): on a `v*` tag, or by hand (Actions → Release bundle → Run
workflow) on `main` only. It needs four repository secrets, and fails with a
message naming any that are missing:

| Secret | Value |
|---|---|
| `CARGO_PANIC_UPLOAD_KEYSTORE_BASE64` | the upload `.jks` in base64 (`base64 -w0 cargo-panic-upload.jks` on Linux, `base64 -i cargo-panic-upload.jks` on macOS) |
| `CARGO_PANIC_KEYSTORE_PASSWORD` | the keystore's password |
| `CARGO_PANIC_KEY_ALIAS` | `upload` |
| `CARGO_PANIC_KEY_PASSWORD` | the key's password |

It checks out the whole history, numbers the build by main's commit count,
runs the type check and unit tests, `npm run android`, unpacks the key into
the runner's temp directory, runs `./gradlew bundleRelease`, deletes the key
(always, even after a failure) and uploads the signed bundle as the artifact
`cargo-panic-<tag or branch>-<versionCode>` (`app-release.aab`, kept 30
days). [`.github/workflows/ci.yml`](.github/workflows/ci.yml) builds a debug
APK on every pull request and push to `main` (artifact
`cargo-panic-debug-apk`). Upload the `.aab` in the Play Console and enrol in
Play App Signing.

Verified by building here (not on a device): `assembleDebug` and
`bundleRelease` with and without an upload key (a throwaway one), the APK's
package, version and signer, and that the bundle carries no `.so`. Still to
check on a real phone before the first release: the splash, the portrait
lock, the hidden bars and the HUD clear of the cutout, the screen staying on,
the icons on a launcher, the back button and background/foreground pause.

The web build is also deployed to GitHub Pages by
[`.github/workflows/deploy.yml`](.github/workflows/deploy.yml) on every push to
`main`. Both QA gates run before the deploy step, so a build only reaches Pages
if every campaign level and a 1,600-wave generator sweep still pass.

Haptics currently go through `navigator.vibrate`
([`src/game/systems/Haptics.ts`](src/game/systems/Haptics.ts)); swapping in
`@capacitor/haptics` means editing only that file.

### Ads (off)

No ad SDK is installed and there is no AdMob app id or ad unit id anywhere in
this repository. [`src/platform/ads.ts`](src/platform/ads.ts) is the boundary:
an `AdProvider` (`isAvailable()`, and `showRewarded()` resolving to
`'rewarded'`, `'dismissed'` or `'failed'`), the default `NoAds`, and
`installAds(provider)`, called once in `main.ts`, which puts a rewarded gate
in front of the hint button only when the provider says it can show ads.
With `NoAds` hints are free and the game behaves exactly as without the
boundary. With a provider, the gate grants a hint only after `'rewarded'`,
shows one ad at a time, and never asks in campaign levels 1-3
(`FREE_HINT_LEVELS`): the brief's rule, no ad offers in the first three
levels. `tests/unit/ads.test.ts` covers it.

To turn rewarded hints on later:

1. **AdMob**: create the account, add the app (Android,
   `com.keremcan534.cargopanic`) and one *Rewarded* ad unit. Note the
   app id (`ca-app-pub-…~…`) and the unit id (`ca-app-pub-…/…`).
2. **Plugin**: install a Capacitor AdMob plugin that supports Capacitor 8
   (for example `@capacitor-community/admob`; check its release notes), then
   `npx cap sync android`.
3. **App id** in `android/app/src/main/AndroidManifest.xml`, inside
   `<application>` (the Mobile Ads SDK stops the app at launch without it):
   `<meta-data android:name="com.google.android.gms.ads.APPLICATION_ID" android:value="${admobAppId}"/>`,
   with `manifestPlaceholders = [admobAppId: …]` in `android/app/build.gradle`
   filled from a Gradle property or an environment variable at build time.
4. **Rewarded unit id** at web-build time:
   `VITE_ADMOB_REWARDED_ID=… npm run build`, read as
   `import.meta.env.VITE_ADMOB_REWARDED_ID`. While developing, use Google's
   published *test* ad unit ids, never live ones, and never tap your own live
   ads.
5. **Provider**: write `src/platform/admob.ts` implementing `AdProvider` over
   the plugin (initialise; prepare and show the rewarded ad; resolve
   `'rewarded'` only on the reward event). Load it by dynamic import only in
   the native shell, as `lifecycle.ts` does with `@capacitor/app`, and call
   `installAds(provider)` once it is ready. `isAvailable()` stays false until
   the SDK is initialised, consent is settled and a unit id is set.
6. **Consent (UMP)**: set up the GDPR (and US state) messages in AdMob's
   *Privacy & messaging*. At start, request consent info and show the form
   when required, before requesting any ad (the plugin wraps Google's User
   Messaging Platform), and offer a *privacy options* entry in settings when
   UMP says one is required.
7. **UI**: show that the hint costs a video (outside levels 1-3), and check
   that the hint lands correctly after the ad (the full-screen ad sends the
   app to the background, so the game is paused when the reward arrives).
8. **Play Console**: *App content > Ads*: "Yes, my app contains ads". Update
   the *Data safety* form for what the Mobile Ads SDK collects and shares
   (advertising id and other device identifiers, app interactions,
   diagnostics); complete the *Advertising ID* declaration (the SDK adds the
   `AD_ID` permission); re-check *Target audience* (ads shown to children
   fall under the Families policy); and update the privacy policy
   (`public/privacy.html`) to name AdMob, the data it uses, consent and how
   to withdraw it.

### Store assets (video, screenshots, feature graphic, icon)

```bash
npm run store:assets     # all of it: record clips, render the video, render the images
npm run store:capture    # build, then record the clips and menu screenshots
npm run store:video      # the trailer (needs ffmpeg with libx264 on the PATH)
npm run store:stills     # screenshots, feature graphic and icon
npm run store:explore    # one still per candidate scene, for choosing shots
```

Everything is made from the real game; nothing is mocked up.

- **Capture** ([`marketing/capture.ts`](marketing/capture.ts),
  [`marketing/capture/`](marketing/capture/)). The built game runs in headless
  Chromium at a 412 × 915 phone screen, 2× pixel ratio, 3D quality HIGH.
  - An init script ([`vclock.ts`](marketing/capture/vclock.ts)) replaces
    `requestAnimationFrame`, timers, `performance.now`, `Date.now`, `Math.random`
    and CSS animations with one virtual clock. The game therefore advances
    exactly 1/30 s per recorded frame, however slowly software WebGL draws, and a
    re-run records the same frames.
  - Clips start from real saves written by the game's own `SaveStore`, holding a
    mid-level board built with real `GameSession` moves and restored through the
    menu's CONTINUE.
  - They are played with real touch input (CDP touch events).
  - The finger's position is logged per frame, and every touch becomes a ring
    and a click in the edit.
  - Menus are captured as screenshots, with the rectangles of the tapped buttons
    saved to `menus.json`.
- **Storyboard** ([`marketing/storyboard.ts`](marketing/storyboard.ts)). The
  trailer is laid out on a 120 BPM grid, so every cut falls on a beat and every
  scene starts on a bar. Each clip is pinned to the beat grid by a recorded
  event (a drop) or a frame (the collapse, the win panel).
  [`timeline.ts`](marketing/timeline.ts) turns this into one timeline that both
  the picture and the sound follow.
- **Picture** ([`marketing/compose/`](marketing/compose/),
  [`render.ts`](marketing/render.ts)).
  - A page draws frame `t` with `renderAt(t)`; every value is computed from
    `t`, with no CSS animation.
  - Headlines rise letter by letter from a mask with expo and spring easing.
  - Menus sit on an unbranded tilted phone.
  - Scene changes use a flash, a whip pan or a hazard-stripe wipe band in the
    game's colours.
  - The film grain is one fixed tile, so it costs nothing to encode.
  - Playwright screenshots each frame into ffmpeg: H.264, `yuv420p`, CRF 18,
    `+faststart`, 1920 × 1080, 30 fps.
- **Sound** ([`marketing/audio.ts`](marketing/audio.ts)).
  - Synthesised in code, with no samples: kick, snare, hats, bass, pad and a
    plucked arpeggio.
  - Whooshes on transitions, clicks on touches, chimes on rewards and an impact
    when the rack falls.
  - Normalised with two-pass `loudnorm` to −14 LUFS integrated, −1 dBTP.
- **Review and output.**
  - `render.ts` writes `marketing/out/contact-sheet.jpg` (2 frames per second)
    for review.
  - It also writes a two-pass share copy when the master is over 30 MB.
  - Videos and recordings stay in `marketing/out/` (git-ignored).
  - The Play Console takes the promo video as a YouTube link, so the video is
    not part of the fastlane metadata.
- **Store images** ([`marketing/stills.ts`](marketing/stills.ts)) go into
  fastlane's supply layout under
  [`fastlane/metadata/android/en-US/images/`](fastlane/metadata/android/en-US/images/):
  - `phoneScreenshots/` — six 1920 × 1080 frames, each with a headline;
  - `featureGraphic.jpg` — 1024 × 500, an in-engine shot with the interface
    hidden, plus the wordmark;
  - `icon.png` — 512 × 512, the game's own mark from `index.html`.
- **Fonts.** On an Android phone the game draws in Roboto (the system sans
  used when Trebuchet MS is missing). The capture maps the game's font stack to
  the bundled Roboto ([`marketing/fonts/`](marketing/fonts/), SIL Open Font
  License), so shots look the same on any machine, and the edit uses it too.
- **Settings** (sizes, frame rate, quality, loudness, brand colours) live in
  [`marketing/config.ts`](marketing/config.ts).
- **Turkish images.** `STORE_LANG=tr npm run store:capture && STORE_LANG=tr npm run store:stills`
  records the clips with the game set to Turkish (into `marketing/out/clips-tr`)
  and writes `fastlane/metadata/android/tr-TR/images/`, with the Turkish
  headlines from `STORE_SHOTS` in the storyboard.
- **Listing texts** (title, short and full description, release notes) are in
  `fastlane/metadata/android/{en-US,tr-TR}/`. The privacy policy is
  [`public/privacy.html`](public/privacy.html), served with the web build.
  [`docs/play-console.md`](docs/play-console.md) lists the answers for the Play
  Console forms and the steps only the account owner can take.

---

## Project layout

```
src/
  main.ts                  boots the saved view (2D or 3D) through the StageHost; save notices; lifecycle; error recovery; gesture lockdown
  app/
    App.ts                 StageHost + the single FrameLoop + Router; view switching, context-loss fallback, hide/show/back
    activePlay.ts          the game in progress into and out of the save; an Endless wave banked in one write
    FrameTimers.ts         outcome and between-wave delays on the frame clock (frozen while hidden)
    StageHost.ts           owns the one Stage, the only writer of loop.stage; serialised switches
    FrameLoop.ts           the only requestAnimationFrame loop (a throwing subscriber is reported, the loop goes on)
    recovery.ts            unexpected errors: whose they are, back to the menu with the save written, crash-loop hold
    Router.ts              one stage, one UI root, one screen at a time
    Game.ts                gameplay controller: GameSession, HUD/panels, audio, win/fail, endless
    PauseReasons.ts        why the session is paused (menu, legend, switching, hidden, context-lost)
  input/
    InteractionController.ts  pointer state machine -> session commands + view calls
  render/
    GameView.ts, Stage.ts  renderer contracts (no three.js)
    createStage.ts         makes a Stage; the ONLY (dynamic) import of the 3D renderer, 2D fallback
    quality.ts             3D quality profiles (auto / low / high) and the adaptive ladder
    hero.ts                the title screen's hero rack and the rule that fits it between the menu's text and buttons, shared by both renderers
    layout.ts              screen bands and slot hit-testing shared by every renderer
    Tween.ts               tween runner
    art/                   canvas artwork for cargo faces and shelf labels (text fitted to its box)
    canvas2d/              the Canvas 2D renderer: stage, game view, backdrops, particles
    three/                 everything that imports three.js (loaded only when 3D is chosen):
      ThreeStage.ts        WebGL renderer, camera, post chain, particles, shake, picking
      ThreeGameView.ts     the 3D game view (drag, landings, spills, dispatch, confetti)
      backdrops.ts         menu and level-select scenes
      Framing.ts           camera framing solver
      Materials.ts         PBR materials from the canvas artwork
      Warehouse.ts, Particles.ts, world/{Rack3D,Shelf3D,Cargo3D,Conveyor3D}
  platform/
    lifecycle.ts           hidden / shown / back: the web page lifecycle, and the Capacitor App plugin in the Android shell
    storage.ts             where the save is kept
    ads.ts                 the ads boundary: AdProvider, NoAds (the default), the rewarded hint gate
  ui/                      DOM: Hud, Meter, Panels, Menu, LevelSelect, Splash, ViewSettings, Notice, SaveNotices
  i18n/                    languages.ts (codes, names, locales, device tags), index.ts (t, fmt, formatScore),
                           one dictionary per language: en (source), tr, de, es, fr, it, pl, pt, ru, id
  game/
    config.ts              tuning constants and world proportions
    session/               GameSession: the pure rules state and commands
    systems/               Balance, Placement, Hazard, Solver, Rng, RunManager,
                           Audio, Haptics, Hint gate, Progress
    levels/                campaign data, package specs, endless generator
android/                   the Capacitor Android project (npx cap sync android copies dist/ in)
scripts/
  gradle/maven-mirror.init.gradle  Gradle init script: Maven Central through Google's mirror (HTTP 429)
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
[`src/platform/ads.ts`](src/platform/ads.ts) does that, and only when an ad
provider can show ads; the shipped default, `NoAds`, leaves hints free (see
[Ads (off)](#ads-off)).
