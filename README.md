# Disposabl Exact

Starter kit for building apps and agents with Exact and Convex.

## Choose platforms and features

[disposabl.json](disposabl.json) controls which platforms deploy and which features the deployed app uses.

```json
{
  "platforms": ["web"],
  "features": ["authentication"]
}
```

- Choose any combination of `web`, `android`, `ios`, `macos`, `api`, `mcp`, `cli`, and `typescript-sdk`. Selecting either developer client also enables the REST API. A merge to main deploys the backend and delivers updates for the selected apps. API, MCP, CLI and SDK have no separate deployment jobs.
- Choose `authentication` to enable app sign-in. Choose `payments` alongside `authentication` to enable account billing. Set `features` to `[]` to disable both. Payments also need the provider configuration below.
- Commit and deploy a configuration change to enable or disable a selection. Connected clients receive the updated feature settings. Deploy App always requires the Convex deployment key. With an empty platform list, it deploys the backend to turn off the previously published endpoints and skips every client build. Existing accounts, billing records, API keys, and installers are retained.

When upgrading a draft configuration that listed only `api` and `mcp`, add the client platforms you were shipping and list your enabled features explicitly. An app already using Autumn should include both `authentication` and `payments`.

`bun run dev` in `packages/backend` validates `disposabl.json` before starting Convex. The backend and CI share the validator in [platform.ts](packages/disposabl-kit/server/platform.ts). App clients subscribe to `app:features` for the active settings.

## First deployment from a new repository

Enable GitHub Actions on the repository provisioned by the generator. For web, enable Convex Static Hosting. The workflow uses two repository secrets, `CONVEX_DEPLOY_KEY` for main and `CONVEX_DEPLOY_KEY_PREVIEW` for same-repository pull requests. Forks build with placeholder origins. Each preview uses its own Convex deployment named `pr-<number>`.

For any native platform, the generator provisions `EXACT_UPDATE_SEED` in the repository’s `android-production` GitHub environment. Android also gets a persistent APK signing key for direct installation. To add native delivery after creating a project, run `bash .github/ci/android-key.sh android` for Android or `bash .github/ci/android-key.sh update` for Apple platforms only. Running these commands again reuses the existing keys.

On the first deployment, CI builds each selected native app on Ubuntu and writes its AppDrop link to the job summary. Android produces a signed APK, iOS produces a device IPA for re-signing, and macOS produces an ad-hoc-signed, non-notarized app ZIP. Subsequent deployments publish compatible app changes as signed over-the-air updates. Changes that require a new native binary or include changed static assets produce a new installer link. Web and its backend share a Convex site URL. Pull requests preview web only.

## Exact updates

Store-installed apps can offer a newer native build on the home screen through `@exact/store-update`. Apple opens the App Store listing. Google Play downloads the update in the background when supported and offers a restart once it is ready. The feature uses the installed app's store identity and needs no extra environment variables or credentials. AppDrop installs use the signed update flow above.

Generated repositories call Disposabl's shared deployment workflow on `main`. Each deployment resolves the current upstream Exact commit once. When that commit is newer than the latest cache, the app builds from source. The central Disposabl repository checks upstream every six hours, builds shared caches from a public fixture, and refreshes the Boat development snapshot. A new app's first build can use these shared tools immediately after publication.

### Run the app locally

Set `EXACT` to an up-to-date checkout of [expo/exact](https://github.com/expo/exact). The shared Boat sandbox includes web, Android and Apple cross-build tools on 4 vCPU and 8 GB. The same share code follows future refreshes of `exact-dev`. Create a sandbox with the command below. A login shell loads the toolchain automatically.

```sh
boat new --type default --no-env --from bsh_hvAwp0phMPSKIjvJPxpHipEdJCa3iQQ1wyXzS465pzi
```

From an Exact app directory, build an unsigned iPhone IPA or an ad-hoc-signed macOS app.

```sh
exact ios --device --release --unsigned --archive app.ipa
exact mac --release
```

The first command for each Apple platform downloads its SDK into the sandbox. Later builds reuse it. The Boat image omits emulator and simulator runtimes. An unsigned iPhone IPA still needs signing before installation.

Install dependencies in `packages/backend`, then run `bun run dev` there. In `apps/apps`, run `bun exact.mjs --help` and `bun install`. Set `CONVEX_ORIGIN` to the backend WebSocket origin and `CONVEX_SITE_ORIGIN` to its HTTP actions origin. For a local deployment these are typically `ws://127.0.0.1:3210` and `http://127.0.0.1:3211`. CI reads both origins from Convex.

Build the web app with `bun run build` from `apps/apps`. From `packages/backend`, run `bun run static-hosting upload --dist ../../apps/apps/dist` and open the HTTP actions origin. The web app and auth endpoints share that origin so the browser can use an HttpOnly cookie. Keep the generated `/.exact/auth/callback` and its script in the upload.

### Authentication

Exact uses Convex Auth `2.1.0` on web, Android, and iOS. Username and password work on a fresh deployment. Google appears after both `AUTH_GOOGLE_CLIENT_ID` and `AUTH_GOOGLE_CLIENT_SECRET` are set on that Convex deployment and the backend is redeployed. Use a Google **web application** client and register `<Convex HTTP actions origin>/oauth/google/callback` as its authorized redirect URI. Set the values through Convex, where the Google component can read them through environment bindings. To disable Google on a configured deployment, blank either value and redeploy before removing the variables. Keep the same Google OAuth client for each deployment's existing accounts.

Android and iOS use the system browser for Google. The Convex callback returns through a fixed app URL scheme, and the app must hold the separate Convex state to redeem the one-time ticket. The web session lives in a Secure, HttpOnly cookie. Native sessions live in the Keychain or Android Keystore-backed storage. Sign-out revokes the backing Convex session before the app clears its session. Queries for account data verify the session server-side.

### API and MCP

Select `api` for REST, `mcp` for MCP, or both in [disposabl.json](disposabl.json). Import `internalQuery`, `internalMutation` or `internalAction` from `@disposabl-kit/server`, then add `platforms: true` to an exported function. Add `userId: v.id("users")` if the function uses account data. The server supplies the verified user ID.

`bun run dev` and deployment discover marked functions automatically. For a Node-only action, expose a default-runtime internal action that calls it. In any Exact app data source, call the same function with `callPlatform("module:function", args, store)` from [auth.ts](apps/apps/auth.ts). The call uses the signed-in app session on web, Android, iOS and macOS.

Sign in on the Exact web app at `/dashboard/api-keys` to create or revoke a key or disconnect an MCP client. Send it as `Authorization: Bearer <key>` to REST or MCP. An OAuth-capable MCP client can connect to `/mcp`, send you to the consent page, and receive a token for that MCP server after you approve. Read access allows queries and explicitly read-only actions. Write access allows mutations and other actions.

REST read operations use GET with URL parameters. Write operations take a JSON body with POST. `/openapi.json` describes the available operations and their scopes.

With web and authentication enabled, Exact web serves `/dashboard/api-keys` and MCP consent. When either is off, use a bearer API key created by a deployment operator. Create a service identity once from `packages/backend`, then use its ID when issuing or rotating a scoped key. Store the returned key securely.

```sh
bun run convex run mcp:createServiceUser '{"name":"My integration"}'
bun run convex run mcp:createApiKeyForUser '{"userId":"<service user ID>","scopes":["read"]}'
```

Use `["read","write"]` for an integration that needs write access. Revoke the key with `mcp:revokeServiceKey`, passing the `id` and `userId` returned on creation. Use `--prod` for the production deployment.

### CLI and TypeScript SDK

Choose `cli` or `typescript-sdk` to enable the corresponding client. The SDK uses the app’s OpenAPI contract.

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
