# Disposabl Exact

Starter kit for building apps and agents with Exact and Convex.

## First deployment from a new repository

Create a repository from this template and enable it in GitHub Actions and Blacksmith. Use a Convex project with Static Hosting enabled. Configure the following GitHub Actions secrets before the push that starts your first deployment.

| Scope | Name | Value |
| --- | --- | --- |
| Repository | `CONVEX_DEPLOY_KEY` | Convex production deploy key |
| `android-production` environment | `EXACT_UPDATE_SEED` | Independent 32-byte, base64-encoded mobile update signing seed |
| `android-production` environment | `ANDROID_APK_SIGNING` | JSON containing the base64 PKCS12 `keystore` and its `password`, with key alias `android` |

Create `android-production` in **Settings → Environments** and restrict it to `main`. Both mobile platforms use this environment. Environment secrets are available for public repositories on GitHub Free. [GitHub environment availability](https://docs.github.com/en/actions/how-tos/deploy/configure-and-manage-deployments/manage-environments)

Set the Convex key at repository scope. To provision the mobile signing secrets, run the following once from your clone with a repository administrator's GitHub CLI login. A GitHub-hosted runner generates the keys and encrypts them with the environment's public key. The command saves the encrypted values and keeps any existing keys.

```sh
python3 .github/actions/exact-setup/scripts/setup-signing.py
```

Push or merge to `main` to deploy. The first deployment starts web, Android and iOS in parallel. Open **Deploy app** for the signed Android APK, the iPhone IPA and an unlisted AppDrop install link for each phone. Anyone with the corresponding link can download the app. Complete signing on the iPhone with your own Apple ID through AppDrop/Tuft. Free provisioning needs periodic renewal on the phone, including while the app receives over-the-air updates.

## iPhone builds

Blacksmith macOS 27 with Xcode builds the first IPA and any replacement native binary. Blacksmith Ubuntu 26.04 handles web, Android, and compatible iOS updates. The shared iOS setup bundle contains Rust and Hermes tools. Xcode and the Apple SDK come from the hosted runner.

## Subsequent deployments

Web uploads to Convex Static Hosting on every deployment. Android and iOS use Exact's signed update store on AppDrop. Compatible app view, TypeScript and asset changes publish to installed apps. Exact checks on launch or foreground and activates downloaded content on a subsequent cold launch. A native version bump in `apps/apps/app.json`, SDK change, or incompatible permissions or capabilities requires a replacement native build. The workflow uses the production build receipt to initialize each stream. For a new phone, use the existing install link. Compatible deployments keep that link in the Actions summary. CI saves it in the Convex environment as `EXACT_INSTALL_ANDROID` or `EXACT_INSTALL_IOS` after a successful native build.

Change the Exact SHA in [pin.env](.github/actions/exact-setup/pin.env) and merge the PR into `disposabl-dev/disposabl-exact:main`. The publisher builds the matching web tools, Android Cargo and Gradle caches, and iOS Cargo cache. Reviewed iOS linker configurations also get a Swift host catalog. Deployment waits for the versioned release and checks its asset digests before using it. Ordinary app changes reuse the release for the current pin.

The one-minute target covers web deployment and compatible mobile updates, including queueing and transfers.

### Android App Bundles and Google Play

Append `--play` to the signing setup command to also create the `ANDROID_PLAY_UPLOAD_SIGNING` environment secret. Set the `ANDROID_PLAY_CONNECTED` Actions **variable** to `true` in `android-production` and bump the app version for the first Play build. The default Android build produces a release APK signed with the app’s standalone key. A Play-connected build also produces an AAB signed with the Play upload key. If the artifacts have incompatible native receipts, CI keeps the verified APK and fails the job before publishing the AAB. [Play App Signing](https://developer.android.com/studio/publish/app-signing)

### Run the app locally

Install dependencies in `packages/backend`, then run `bun run convex dev` there. In `apps/apps`, run `bun exact.mjs --help` and `bun install`. Set `CONVEX_ORIGIN` to the backend WebSocket origin and `CONVEX_SITE_ORIGIN` to its HTTP actions origin. For a local deployment these are typically `ws://127.0.0.1:3210` and `http://127.0.0.1:3211`. CI reads both origins from Convex.

Build the web app with `bun run build` from `apps/apps`. From `packages/backend`, run `bun run static-hosting upload --dist ../../apps/apps/dist` and open the HTTP actions origin. The web app and auth endpoints share that origin so the browser can use an HttpOnly cookie. Keep the generated `/.exact/auth/callback` and its script in the upload.

### Authentication

Exact uses Convex Auth `2.1.0` on web, Android, and iOS. Username and password work on a fresh deployment. Google appears after both `AUTH_GOOGLE_CLIENT_ID` and `AUTH_GOOGLE_CLIENT_SECRET` are set on that Convex deployment and the backend is redeployed. Use a Google **web application** client and register `<Convex HTTP actions origin>/oauth/google/callback` as its authorized redirect URI. Set the values through Convex, where the Google component can read them through environment bindings. To disable Google on a configured deployment, blank either value and redeploy before removing the variables. Keep the same Google OAuth client for each deployment's existing accounts.

Android and iOS use the system browser for Google. The Convex callback returns through a fixed app URL scheme, and the app must hold the separate Convex state to redeem the one-time ticket. The web session lives in a Secure, HttpOnly cookie. Native sessions live in the Keychain or Android Keystore-backed storage. Sign-out revokes the backing Convex session before the app clears its session. Queries for account data verify the session server-side.

Run `bun --env-file=.env.local test ./tests/auth.e2e.ts` from `packages/backend` against an isolated local deployment. Set `EXPECT_GOOGLE=0` or `EXPECT_GOOGLE=1` to assert the expected Google configuration.

### Translations

Exact follows the browser or device language at launch and falls back to English. The language picker can override it locally and can return to the device language. Arabic inherits Exact's right-to-left layout.

Put app-authored copy in `apps/apps/strings/<locale>.json` and render it with `t("key")`. Write placeholders as `{name}` in the catalog and supply them with `t("key", name=value)`. Exact also accepts the MessageFormat 2 spelling `{$name}`. Pass error codes from the data module and map them to literal translation keys in `authErrorText` in Contract. Add a mapping there when an auth code needs its own message.

To add a language, add `strings/<locale>.json` with the same keys and placeholders as the base catalog. Exact defaults to English. The build checks coverage and populates the dropdown from the catalog filenames. Single-language apps hide the dropdown. Switching works offline. The installed app name comes from `app.json` and uses the same name across locales at this Exact version.

Exact validates translation calls and catalog syntax when it compiles the app. From `apps/apps`, run the Contract tests to check language switching, persistence, and fallback.

```sh
bun exact.mjs test web
```

## Monorepo layout

- `apps/apps` for the Exact app
- `packages/backend` for the Convex backend

## Optional billing

Billing starts disabled. Set `BILLING_MODE=preview` on a separate Convex deployment to let signed-in Android and iOS testers buy simulated products. A simulated purchase is labeled in the app, goes through Convex, and updates a preview-only credit balance. Apple and Google accounts are unnecessary for this test.

Set `AUTUMN_SECRET_KEY` on the preview deployment to an Autumn **test-mode** key to enable web checkout at `/pricing`. Exact pricing reads the [code catalog](packages/backend/convex/billingCatalog.ts), Convex calls Autumn, and the browser opens Stripe Checkout. The app refreshes the balance from Autumn after payment. Keep the key in Convex.

From `packages/backend`, inspect the selected deployment's catalog before turning on checkout.

```sh
bun run convex run billing:syncCatalog '{"apply":false}'
bun run convex run billing:syncCatalog '{"apply":true}'
```

The second command creates missing catalog entries and publishes a new plan version when the configured price or credits change. Existing subscribers stay on their version. Only apply it on an Autumn environment where this repository owns the configured plan IDs. Set the production GitHub Actions variable `BILLING_SYNC_CATALOG=true` to sync automatically after deploying the production backend. The catalog's default amounts are USD, so use a matching Autumn catalog currency.

### Live store purchases

Set `BILLING_MODE=production` and a live `AUTUMN_SECRET_KEY` on the production Convex deployment. This enables web checkout. Native offers appear for a connected platform once the app can read the corresponding products from the store. Set up the store product IDs from the code catalog, with one monthly Play base plan and one consumable credit pack on each platform. The store supplies the displayed native price.

- **Apple.** Configure the matching bundle ID, products, agreements, distribution signing and App Store Server Notifications V2 at `/api/billing/apple-notifications`. Set `BILLING_APPLE_BUNDLE_ID`, `BILLING_APPLE_APP_ID` and `BILLING_APPLE_ROOTS` in Convex. Roots are comma-separated base64 DER certificates from Apple PKI. Set `BILLING_APPLE_CONNECTED=true` after connecting the store and notification endpoint.
- **Google.** Configure the Play package, its products, a service account with Android Publisher access, and an authenticated Pub/Sub push subscription for Play billing notifications to `/api/billing/google-notifications`. Set `BILLING_GOOGLE_PACKAGE`, `BILLING_GOOGLE_SERVICE_ACCOUNT` (service account JSON), `BILLING_GOOGLE_PUSH_AUDIENCE` and `BILLING_GOOGLE_PUSH_EMAIL` in Convex. Build the Play AAB through the existing `ANDROID_PLAY_CONNECTED` production setting.

The app verifies and records the purchase in Convex before finishing it in StoreKit or Play. The pricing screen combines Autumn web credits with credits granted by the native stores. The iOS AppDrop build is for sideloading. The App Store route still needs a distribution-signed build. Verify native sandbox purchases, restore, renewals, and refunds with store-configured builds before enabling a live rollout.
