# Releasing Cargo Panic on Google Play

Every step from a new developer account to later updates. The form answers
(Data safety, content rating, ads, advertising ID and the rest) are in
[`play-console.md`](play-console.md). A field-by-field walk-through in Turkish
is in [`YAYIN-KONTROL-LISTESI.md`](YAYIN-KONTROL-LISTESI.md).

Requirements were checked against Google's help pages on 1 October 2026:
- **Target API:** new apps and updates must target API 36 from 31 August 2026.
- **Text limits:** title 30, short description 80, full description 4000, release notes 500.
- **Images:**
  - icon: 512 × 512, 32-bit PNG with alpha, ≤ 1024 KB;
  - feature graphic: 1024 × 500, JPEG or 24-bit PNG;
  - screenshots: JPEG or 24-bit PNG, 320–3840 px per side.
- **16 KB pages:** apply only to apps with native `.so` libraries, from 1 February 2027.
- **New personal accounts:** 12 testers, opted in to a closed test for 14 days in a row, before production.

## What the repository has

| Piece | Where |
| --- | --- |
| Android project (Capacitor 8), package `com.keremcan534.cargopanic` | `android/`, `capacitor.config.json` |
| Version name | `package.json` `version` (1.0.0) |
| Version code | `CARGO_PANIC_VERSION_CODE`. Release bundles use main's commit count; CI APKs use the run number. |
| Debug key (public, debug builds only) | `android/app/debug.keystore` |
| CI: tests, browser tests, debug APK | `.github/workflows/ci.yml` |
| Signed bundle (.aab) | `.github/workflows/release.yml` ("Release bundle") |
| Maven Central mirror for HTTP 429 | `scripts/gradle/maven-mirror.init.gradle` |
| Store texts and images, 10 languages | `fastlane/metadata/android/<locale>/` |
| Limits and format test | `tests/unit/storeListing.test.ts` |
| Promo video | `npm run store:video` → `marketing/out/cargo-panic-trailer.mp4` |
| Zip of the images, translations CSV, release notes | `npm run store:pack` → `marketing/out/store/` |
| Privacy policy | `public/privacy.html` → `https://keremcan534.github.io/cargo-panic/privacy.html` |

The target is API 36 and the minimum is API 24. The app has no native
libraries, so the 64-bit and 16 KB page-size rules need nothing.

The game has no ads, no in-app purchases, no account, no analytics, and makes
no network requests. `src/platform/ads.ts` is a switched-off boundary for later
(see the README's "Ads (off)").

## One-time setup

### 1. Google Play developer account

1. Sign up at <https://play.google.com/console/signup> as an individual (personal account). Pay the one-time fee and verify your identity.
2. **A new personal account cannot publish to production straight away.** First it needs a closed test with at least **12 testers who stay opted in for 14 days in a row**. If someone opts out and back in, their 14 days start again.

### 2. The upload key

Google Play keeps the key that signs the app for users (Play App Signing). You
sign each upload with your own **upload key**. Make it once and keep it safe; it
must never go into the repository.

```bash
keytool -genkeypair -v -keystore cargo-panic-upload.jks -alias upload \
  -keyalg RSA -keysize 4096 -validity 10000
```

- With JDK 17+ the file is PKCS12, so the key password is the same as the keystore password.
- Keep the `.jks` file and its password in a password manager or another safe place outside the repository.
- If it is lost, ask for an upload-key reset in the Play Console. The app and its users are unaffected.

### 3. The repository's secrets

Go to GitHub → Settings → Secrets and variables → Actions → **New repository secret** and add these four:

| Secret | Value |
| --- | --- |
| `CARGO_PANIC_UPLOAD_KEYSTORE_BASE64` | The `.jks` in base64. Linux: `base64 -w0 cargo-panic-upload.jks`. macOS: `base64 -i cargo-panic-upload.jks \| pbcopy`. Windows PowerShell: `[Convert]::ToBase64String([IO.File]::ReadAllBytes("cargo-panic-upload.jks")) \| Set-Clipboard` |
| `CARGO_PANIC_KEYSTORE_PASSWORD` | The keystore password |
| `CARGO_PANIC_KEY_ALIAS` | `upload` (the `-alias` above) |
| `CARGO_PANIC_KEY_PASSWORD` | The key password (the same as the keystore password for PKCS12) |

The "Release bundle" workflow stops with an error naming any secret that is missing.

### 4. GitHub Pages (privacy policy)

`.github/workflows/deploy.yml` publishes the web build, including `privacy.html`, on every push to `main`. The policy's address is <https://keremcan534.github.io/cargo-panic/privacy.html>.

### 5. Create the app in the Play Console

1. **Create app**:
   - name: "Cargo Panic: Warehouse Puzzle";
   - default language: English (United States) – en-US;
   - app or game: Game;
   - free or paid: Free.
   Accept the declarations.
2. **Package name.** It is fixed by the first uploaded bundle: `com.keremcan534.cargopanic`. It can never change after that.
3. Fill in **App content** with the answers in [`play-console.md`](play-console.md):
   - privacy policy;
   - app access;
   - ads;
   - content rating;
   - target audience;
   - Data safety;
   - advertising ID;
   - government, financial features, health and news.
4. Fill in **Store settings**: category Game → Puzzle, the contact e-mail and, if you like, a website.
5. Fill in **Main store listing** in each language from `fastlane/metadata/android/<locale>/`.
   - Paste the texts by hand, or use `marketing/out/store/translations.csv`.
   - Upload the images from `cargo-panic-store-images.zip`.
   - The other languages use the en-US icon and feature graphic.
   - Promo video: the Play Console takes only a **YouTube URL** (see "Promo video" below).

## Each release

### 1. Before building

- [ ] `main` is green in CI: typecheck, unit tests, build, validators, browser tests and debug APK.
- [ ] `package.json` `version` is raised (1.0.0 → 1.0.1 …).
- [ ] Release notes are written for every language: `fastlane/metadata/android/<locale>/changelogs/default.txt` (≤ 500 characters), or `<versionCode>.txt` for one build only. `npm test` checks the limits.
- [ ] The CI debug APK has been tried on a real phone. Install it from the CI run's artifact `cargo-panic-debug-apk`; it installs over the previous one and keeps the save.

### 2. Build the signed bundle

- On GitHub: Actions → **Release bundle** → Run workflow (branch `main`), or tag one of main's commits:
  `git switch main && git pull && git tag v1.0.1 && git push origin v1.0.1`.
  The workflow refuses a commit that is not on main.
- The artifact is `cargo-panic-<ref>-<versionCode>`, containing `app-release.aab`.
- The versionCode is `git rev-list --count HEAD` on main, so it only goes up.
- **The first bundle (1.0.0) was uploaded as versionCode 73**, main's commit count when it was built. Play never
  takes the same number twice, so the next bundle needs at least one new commit on main (the version bump below
  is one). A run on main without new commits gives 73 again and Play refuses it.
- On your own machine, if you prefer (from a commit on main):

```bash
export CARGO_PANIC_KEYSTORE_FILE=/path/to/cargo-panic-upload.jks
export CARGO_PANIC_KEYSTORE_PASSWORD=… CARGO_PANIC_KEY_ALIAS=upload CARGO_PANIC_KEY_PASSWORD=…
git switch main && git pull                     # the number must be main's commit count
export CARGO_PANIC_VERSION_CODE=$(git rev-list --count HEAD)
npm ci && npm run android
cd android && ./gradlew bundleRelease          # if Maven Central answers 429:
# ./gradlew --init-script ../scripts/gradle/maven-mirror.init.gradle bundleRelease
```

### 3. Upload it, in order

1. **Internal testing.** Create a release, upload the `.aab`, and paste the release notes from `npm run release:notes`. Add yourself as a tester and install it from the Play Store.
2. **Closed testing.** Use the same bundle, or "Promote release", with at least 12 testers (a Google Group or an e-mail list). They must accept the opt-in link and **stay in for 14 days in a row**. Ask them to open the game; this also gives useful feedback.
3. After 14 days, go to **Dashboard → Apply for production**. Answer the questions about the test; Google reviews them, usually within a few days.
4. **Production.** Create a release from the tested bundle. A staged rollout (e.g. 20 % first) is a good idea.

### 4. Later updates

- Raise `package.json` `version`, write new `changelogs/default.txt`, merge to main, then run **Release bundle** again; the versionCode rises by itself.
- Never change the package name or lose the upload key.
- Changes to the store text or images don't need a new bundle: edit them in the Play Console or with `fastlane supply`.
- If ads, analytics or purchases are ever added, update the privacy policy, Data safety, "Contains ads", the advertising ID declaration and the target audience **before** that release.

## Promo video (YouTube)

1. Make it with `npm run store:video`: 34 s, 1920 × 1080, H.264, original synthesised music.
2. Upload it to YouTube with these settings:
   - **visibility:** Public or **Unlisted** (not Private);
   - **monetisation/ads:** off (Google Play does not show videos with ads);
   - **embedding:** allowed (Show more → "Allow embedding");
   - **audience:** "No, it's not made for kids" or "Yes" as appropriate, but **no age restriction**.
3. Paste the video's URL (not a playlist or channel) into "Video" in the main store listing. You can use the same URL for every language.

## Store assets

- `npm run store:capture` / `store:stills` / `store:video` / `store:pack`: see the README's "Store assets" section.
- For another language: `STORE_LANG=<code> npm run store:capture && STORE_LANG=<code> npm run store:stills`. The codes are en, tr, de, es, fr, it, pl, pt, ru and id.
- The 8 languages other than English and Turkish are **machine translations**, both in the game (`docs/TRANSLATIONS.md`) and in the store texts. Have a native speaker read them before release.
