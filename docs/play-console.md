# Google Play Console - listing checklist

What is ready in this repository, and what only the account owner can do.
Everything under "Ready" is generated or written in the repo; nothing here was
uploaded anywhere.

## Ready

| Play Console field | Where |
| --- | --- |
| App name (≤ 30) | `fastlane/metadata/android/<locale>/title.txt` |
| Short description (≤ 80) | `.../short_description.txt` |
| Full description (≤ 4000) | `.../full_description.txt` |
| Release notes for versionCode 1 | `.../changelogs/1.txt` |
| Phone screenshots, 1920 × 1080 | `.../images/phoneScreenshots/` (6 per language) |
| Feature graphic, 1024 × 500 JPEG | `.../images/featureGraphic.jpg` |
| App icon, 512 × 512 PNG | `.../images/icon.png` |
| Privacy policy | `public/privacy.html` - served at `https://keremcan534.github.io/cargo-panic/privacy.html` **once it is deployed to `main`** |

Locales: `en-US` (default) and `tr-TR`. The layout is fastlane `supply`'s, so
`fastlane supply --skip_upload_apk --skip_upload_aab` can push the texts and
images once the app exists in the console; they can also be pasted by hand.

The promo video (`npm run store:video`, 34 s, 1920 × 1080) is not part of the
metadata: the Play Console only takes a **YouTube URL**. Upload the video to
YouTube (public or unlisted), then put the URL in
`fastlane/metadata/android/<locale>/video.txt` or in the console.

## Answers for the console forms (true for the current build)

Re-check every answer if ads, analytics, accounts or purchases are added.

- **Contains ads:** No. No ad SDK is in the app (`src/platform/ads.ts` is an off-by-default boundary with no provider).
- **In-app purchases:** None.
- **Data safety:**
  - Does the app collect or share user data? **No.**
  - Progress and settings are stored only on the device (localStorage in the WebView). The game makes no network requests while playing.
  - Encryption in transit and data deletion requests: not applicable, because nothing is collected.
- **App access:** everything is available without login. There is no account.
- **Content rating (IARC questionnaire):**
  - No violence, blood, sexual content, profanity, drugs, gambling or simulated gambling.
  - No user-generated content, no chat, no location sharing and no purchases.
  - Expected outcome: rated for everyone (PEGI 3 / ESRB Everyone). The final rating is IARC's, not ours.
- **Target audience:**
  - The owner decides this.
  - If you include children under 13, the app must meet Families policy.
  - The current build meets it only while it has no ads or data collection.
- **Government app / news app / health / financial features:** No.
- **Permissions:**
  - INTERNET (the Capacitor template default; the game itself makes no network requests) and VIBRATE for haptics - both normal permissions.
  - No dangerous or runtime permissions.

## Only the owner can do this

1. **Developer account.** Create or sign in to the Google Play Console developer account, then create the app with package name `com.blackbluestudios.cargopanic`, from `capacitor.config.json`.
2. **Signing.**
   - Create an upload keystore and keep it out of the repository.
   - Enrol in Play App Signing.
   - Sign the release AAB:
     - build it with `./gradlew bundleRelease` in `android/`;
     - sign with Android Studio → Generate Signed Bundle, or with `jarsigner`/`apksigner`.
3. **Deploy the privacy policy.** Push to `main` so that `privacy.html` is live on GitHub Pages, then paste its URL in the console.
4. **Promo video.** Upload the trailer to YouTube and add the link.
5. **Forms.** Fill in the forms above: Data safety, content rating, target audience and ads.
6. **Test before production.** Start with an internal testing track, install it on at least one real phone, and check:
   - portrait lock;
   - the back button;
   - the app going to the background mid-hazard and being killed, then CONTINUE;
   - 2D and 3D;
   - performance.
   None of this has been tried on a device yet.
7. **Ads, if wanted later.**
   - An AdMob account plus an app ID and ad unit IDs are needed first; see the README's ads section.
   - When ads are added, the "Contains ads" answer, Data safety, the privacy policy and possibly the target audience all change.
