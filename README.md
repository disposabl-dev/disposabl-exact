# Disposabl Exact

Starter kit for building apps and agents with Exact and Convex.

## Choose platforms and features

[disposabl.json](disposabl.json) controls which platforms deploy and which features the deployed app uses.

```json
{
  "platforms": ["web", "android", "ios", "macos", "api", "mcp", "cli", "typescript-sdk"],
  "features": ["authentication"]
}
```

- Choose any combination of `web`, `android`, `ios`, `macos`, `api`, `mcp`, `cli`, and `typescript-sdk`. Selecting either developer client also enables the REST API. Deploy App builds only the selected clients, publishes updates only to the selected mobile platforms, and uses a backend-only deployment for API or MCP without web. The macOS job produces a preview.
- Choose `authentication` to enable app sign-in. Choose `payments` alongside `authentication` to enable account billing. Set `features` to `[]` to disable both. Payments also need the provider configuration below.
- Commit and deploy a configuration change to enable or disable a selection. Connected clients receive the updated feature settings. Deploy App always requires the Convex deployment key. With an empty platform list, it deploys the backend to turn off the previously published endpoints and skips every client build. Existing accounts, billing records, API keys, and installers are retained.

When upgrading a draft configuration that listed only `api` and `mcp`, add the client platforms you were shipping and list your enabled features explicitly. An app already using Autumn should include both `authentication` and `payments`.

`bun run dev` in `packages/backend` validates `disposabl.json` before starting Convex. The backend and CI share the validator in [platform.ts](packages/disposabl-kit/server/platform.ts). App clients subscribe to `app:features` for the active settings.

## First deployment from a new repository

Create a repository from this template and enable it in GitHub Actions and Blacksmith. Use a Convex deployment. Enable Static Hosting if you select web. Configure the following GitHub Actions secrets before the push that starts your first deployment.

| Scope | Name | Value |
| --- | --- | --- |
| Repository | `CONVEX_DEPLOY_KEY` | Convex production deploy key |
| `android-production` environment | `EXACT_UPDATE_SEED` | Independent 32-byte, base64-encoded mobile update signing seed |
| `android-production` environment | `ANDROID_APK_SIGNING` | JSON containing the base64 PKCS12 `keystore` and its `password`, with key alias `android` |

Create `android-production` in **Settings → Environments** and restrict it to `main`. Mobile builds use the signing secrets in this environment. Environment secrets are available for public repositories on GitHub Free. [GitHub environment availability](https://docs.github.com/en/actions/how-tos/deploy/configure-and-manage-deployments/manage-environments)

Set the Convex key at repository scope. If you select Android or iOS, provision the mobile signing secrets once from your clone with a repository administrator's GitHub CLI login. A GitHub-hosted runner generates the keys and encrypts them with the environment's public key. The command saves the encrypted values and keeps any existing keys.

```sh
python3 .github/actions/exact-setup/scripts/setup-signing.py
```

Push or merge to `main` to deploy. The first deployment starts the selected platform jobs. Open **Deploy app** for the signed Android APK, the iPhone IPA and an unlisted AppDrop install link for each phone. Anyone with the corresponding link can download the app. Complete signing on the iPhone with your own Apple ID through AppDrop/Tuft. Free provisioning needs periodic renewal on the phone, including while the app receives over-the-air updates.

## iPhone builds

Blacksmith macOS 27 with Xcode builds the first IPA and any replacement native binary. Blacksmith Ubuntu 26.04 handles web, Android, and compatible iOS updates. The shared iOS setup bundle contains Rust and Hermes tools. Xcode and the Apple SDK come from the hosted runner.

## Subsequent deployments

Web uploads to Convex Static Hosting on every deployment. Android and iOS use Exact's signed update store on AppDrop. Compatible app view, TypeScript and asset changes publish to installed apps. Exact checks on launch or foreground and activates downloaded content on a subsequent cold launch. A native version bump in `apps/apps/app.json`, SDK change, or incompatible permissions or capabilities requires a replacement native build. The workflow uses the production build receipt to initialize each stream. For a new phone, use the existing install link. Compatible deployments keep that link in the Actions summary. CI saves it in the Convex environment as `EXACT_INSTALL_ANDROID` or `EXACT_INSTALL_IOS` after a successful native build.

Change the Exact SHA in [pin.env](.github/actions/exact-setup/pin.env) and merge the PR into `disposabl-dev/disposabl-exact:main`. The publisher builds the matching web tools, Android Cargo and Gradle caches, and iOS Cargo cache. Reviewed iOS linker configurations also get a Swift host catalog. Deployment waits for the versioned release and checks its asset digests before using it. Ordinary app changes reuse the release for the current pin.

The one-minute target covers web deployment and compatible mobile updates, including queueing and transfers.

### Android App Bundles and Google Play

Append `--play` to the signing setup command to also create the `ANDROID_PLAY_UPLOAD_SIGNING` environment secret. Set the `ANDROID_PLAY_CONNECTED` Actions **variable** to `true` in `android-production` and bump the app version for the first Play build. The default Android build produces a release APK signed with the app’s standalone key. A Play-connected build also produces an AAB signed with the Play upload key. If the artifacts have incompatible native receipts, CI keeps the verified APK and fails the job before publishing the AAB. [Play App Signing](https://developer.android.com/studio/publish/app-signing)

### Run the app locally

Use the Exact revision in [pin.env](.github/actions/exact-setup/pin.env). Android cache builds and restores automatically apply the [layer-header fix](.github/actions/exact-setup/scripts/android-layer-header.patch) for the revision that needs it. Apply the same patch to that revision in a local Android SDK checkout.

Install dependencies in `packages/backend`, then run `bun run dev` there. In `apps/apps`, run `bun exact.mjs --help` and `bun install`. Set `CONVEX_ORIGIN` to the backend WebSocket origin and `CONVEX_SITE_ORIGIN` to its HTTP actions origin. For a local deployment these are typically `ws://127.0.0.1:3210` and `http://127.0.0.1:3211`. CI reads both origins from Convex.

Build the web app with `bun run build` from `apps/apps`. From `packages/backend`, run `bun run static-hosting upload --dist ../../apps/apps/dist` and open the HTTP actions origin. The web app and auth endpoints share that origin so the browser can use an HttpOnly cookie. Keep the generated `/.exact/auth/callback` and its script in the upload.

### Authentication

Exact uses Convex Auth `2.1.0` on web, Android, and iOS. Username and password work on a fresh deployment. Google appears after both `AUTH_GOOGLE_CLIENT_ID` and `AUTH_GOOGLE_CLIENT_SECRET` are set on that Convex deployment and the backend is redeployed. Use a Google **web application** client and register `<Convex HTTP actions origin>/oauth/google/callback` as its authorized redirect URI. Set the values through Convex, where the Google component can read them through environment bindings. To disable Google on a configured deployment, blank either value and redeploy before removing the variables. Keep the same Google OAuth client for each deployment's existing accounts.

Android and iOS use the system browser for Google. The Convex callback returns through a fixed app URL scheme, and the app must hold the separate Convex state to redeem the one-time ticket. The web session lives in a Secure, HttpOnly cookie. Native sessions live in the Keychain or Android Keystore-backed storage. Sign-out revokes the backing Convex session before the app clears its session. Queries for account data verify the session server-side.

### API and MCP

Select `api` for REST, `mcp` for MCP, or both in [disposabl.json](disposabl.json). Import `internalQuery`, `internalMutation` or `internalAction` from `@disposabl-kit/server`, then add `platforms: true` to an exported function. See [counter.ts](packages/backend/convex/counter.ts). Add `userId: v.id("users")` if the function uses account data. The server supplies the verified user ID.

`bun run dev` and deployment discover marked functions automatically. For a Node-only action, expose a default-runtime internal action that calls it. In any Exact app data source, call the same function with `callPlatform("counter:current", {}, store)` from [auth.ts](apps/apps/auth.ts). The call uses the signed-in app session on web, Android, iOS and macOS.

Sign in on the Exact web app at `/dashboard/api-keys` to create or revoke a key or disconnect an MCP client. Send it as `Authorization: Bearer <key>` to REST or MCP. An OAuth-capable MCP client can connect to `/mcp`, send you to the consent page, and receive a token for that MCP server after you approve. Read access allows queries and explicitly read-only actions. Write access allows mutations and other actions.

The demo is `GET /api/counter/current` and MCP tool `counter_current`. REST read operations use GET with URL parameters. Write operations take a JSON body with POST. `/openapi.json` describes the available operations and their scopes.

With web and authentication enabled, Exact web serves `/dashboard/api-keys` and MCP consent. When either is off, use a bearer API key created by a deployment operator. Create a service identity once from `packages/backend`, then use its ID when issuing or rotating a scoped key. Store the returned key securely.

```sh
bun run convex run mcp:createServiceUser '{"name":"My integration"}'
bun run convex run mcp:createApiKeyForUser '{"userId":"<service user ID>","scopes":["read"]}'
```

Use `["read","write"]` for an integration that needs write access. Revoke the key with `mcp:revokeServiceKey`, passing the `id` and `userId` returned on creation. Use `--prod` for the production deployment.

### CLI and TypeScript SDK

Choose `cli` or `typescript-sdk` to build and test that package in GitHub Actions.
The workflow uploads npm tarballs for the configured app. It generates the SDK
from the app's OpenAPI contract on an isolated Convex deployment.

Both clients use a scoped API key. Sign in on the web app to issue a personal
key, or have a deployment operator issue a service key for a headless app.
When payments are enabled, clients can read their account's plan and credits.
Checkout and billing management are available on the web app.

See the [CLI](packages/cli/README.md) and [SDK](packages/sdk/README.md) for usage.

### Translations

Exact follows the browser or device language at launch and falls back to English. The language picker can override it locally and can return to the device language. Arabic inherits Exact's right-to-left layout.

Put app-authored copy in `apps/apps/strings/<locale>.json` and render it with `t("key")`. Write placeholders as `{name}` in the catalog and supply them with `t("key", name=value)`. Exact also accepts the MessageFormat 2 spelling `{$name}`. Pass error codes from the data module and map them to literal translation keys in `authErrorText` in Contract. Add a mapping there when an auth code needs its own message.

To add a language, add `strings/<locale>.json` with the same keys and placeholders as the base catalog. Exact defaults to English. The build checks coverage and populates the dropdown from the catalog filenames. Single-language apps hide the dropdown. Switching works offline. The installed app name comes from `app.json` and uses the same name across locales at this Exact version.

Exact validates translation calls and catalog syntax when it compiles the app.

## Tests

Run from the repository root in a clean checkout. The access tests use a local Convex deployment without provider secrets.

```sh
bun test packages/backend/tests/config.test.ts
CONVEX_AGENT_MODE=anonymous bun run --cwd packages/backend dev --once --start 'bun --env-file=.env.local test ./tests/access.e2e.ts'
```

With a local backend running, use `bun exact.mjs test web` from `apps/apps` to verify that the web app renders live Convex data.

## Monorepo layout

- `apps/apps` for the Exact app
- `packages/backend` for the Convex backend

## Optional billing

Enable `payments` and `authentication` in `disposabl.json` and set `AUTUMN_SECRET_KEY` in Convex to show `/dashboard/billing`. Web checkout uses Stripe Sandbox with a test key and Stripe live with a live key. Native apps show the Autumn plan and balance and tell web subscribers their billing is managed on the website. Native store purchases and restore require a store integration that syncs into Autumn.

Removing `payments` hides pricing and disables the app’s billing endpoints. Existing subscriptions continue in the billing provider. Manage renewals and cancellations there before removing the app’s customer portal.

In Autumn, create a consumable metered feature named `disposabl_credits`, a USD 5 monthly plan `disposabl_monthly` with 750 credits resetting each month, and a prepaid add-on `disposabl_topup` priced at USD 5 per 500 credits. The [billing action](packages/backend/convex/billing/index.ts) checks the configured offer before sending a signed-in user to checkout.
