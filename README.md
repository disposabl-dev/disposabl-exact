# Disposabl Exact

Starter kit for building apps and agents.

## Build from this template

Use **Use this template → Create a new repository** and clone it. Link `packages/backend` to your Convex project with `bun run convex dev` from that directory after installing dependencies.

The [web workflow](.github/workflows/convex-web.yml) builds the Exact app and uploads `apps/apps/dist/convex` to Convex Static Hosting. Set two repository secrets in **Settings → Secrets and variables → Actions**.

- `CONVEX_DEPLOY_KEY` is the production deploy key. Every push to `main`, including PR merges, deploys production.
- `CONVEX_DEPLOY_KEY_PREVIEW` is the project preview key. Opening or updating a same-repository PR from another branch deploys a preview named for the branch.

The **Deploy web to Convex** run uses the matching Convex backend for each build and prints the live URL after upload. It checks out the pinned Exact SDK and compiles its web tools from source on the runner.

### Run the app locally

With the Exact SDK checkout available, run `bun exact.mjs --help` and `bun install` from `apps/apps`. Set `CONVEX_ORIGIN` in `apps/apps/.env.local` to the WebSocket origin of your development deployment, for example `wss://your-deployment.convex.cloud`. Start the app with `bun exact.mjs web`. The Android and iOS builds read the same setting. The shared counter lets you verify a live query and a write between clients connected to the same deployment.

## Enable automatic updates

Enable GitHub Pages from the root of a `gh-pages` branch containing `.nojekyll`. Create a separate Ed25519 signing key for each app. From the generated app repository, with `EXACT` pointing to the pinned SDK checkout, run:

```sh
key_id="app-updates"
key_dir="$HOME/.config/exact/keys/$(gh repo view --json nameWithOwner -q .nameWithOwner)"
public_key=$(bun "$EXACT/scripts/deploy.mjs" keygen "$key_id" --keys "$key_dir" --json | jq -r .publicKey)
gh secret set EXACT_OTA_SIGNING_KEY < "$key_dir/$key_id.pem"
bun scripts/configure-updates.mjs "$(gh api 'repos/{owner}/{repo}/pages' --jq .html_url)" "$key_id" "$public_key"
gh variable set EXACT_OTA_ENABLED --body true
git add apps/apps/app.json
git commit -m '[native] Enable signed updates'
git push origin main
```

The first build publishes an Android APK, unsigned iOS IPA, macOS app ZIP, and Linux tarball. Their production receipts initialize the signed update streams. Install these bases to receive compatible updates automatically. The iOS archive needs Apple signing before installation. For macOS distribution, sign and notarize the app before sharing it. Use a stable Android APK signing key for in-place binary upgrades. Keep the separate OTA private key outside Git.

Later app edits on `main` publish the web build to Pages and signed updates to compatible installs. Browsers get the new web build on navigation or refresh. The Pages site lists base downloads under `downloads/`. Changes to native inputs trigger replacement builds for affected platforms. A `[native]` commit forces fresh bases.

### Windows

Windows 11 checks for newer signed MSIX packages on launch and in the background after users install through the App Installer feed. Configure an Azure Blob container with public read access and set `WINDOWS_UPDATE_ORIGIN` to its HTTPS URL, including the trailing slash. Set the following GitHub Actions secrets.

- `WINDOWS_MSIX_PFX` and `WINDOWS_MSIX_PASSWORD` for a base64-encoded PFX with a code-signing certificate trusted by the runner and users' devices.
- `WINDOWS_UPDATE_STORAGE_SAS_TOKEN` for write access scoped to the update container.

The **Publish Windows updates** workflow publishes on app edits to `main` once `EXACT_OTA_ENABLED` and the Windows origin are set. Install from `windows.appinstaller` in that container. Keep the package's app ID and certificate publisher identity stable across releases.

## Monorepo layout

- `apps/apps` for the Exact app
- `packages/backend` for the Convex backend

## Planned features

1. Authentication with Google sign-in
2. Payments with Autumn.js on the web and in-app purchases on Android, macOS, and iOS
