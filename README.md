# Disposabl Exact

Starter kit for building apps and agents with Exact and Convex.

## Build from this template

Use **Use this template → Create a new repository** and clone it. Link `packages/backend` to your Convex project with `bun run convex dev` from that directory after installing dependencies.

The [web workflow](.github/workflows/convex-web.yml) builds the Exact app and uploads `apps/apps/dist/convex` to Convex Static Hosting. Set two repository secrets in **Settings → Secrets and variables → Actions**.

- `CONVEX_DEPLOY_KEY` is the production deploy key. Every push to `main`, including PR merges, deploys production.
- `CONVEX_DEPLOY_KEY_PREVIEW` is the project preview key. Opening or updating a same-repository PR from another branch deploys a preview named for the branch.

The **Deploy web to Convex** run uses the matching Convex backend for each build and prints the live URL after upload. GitHub Actions caches the pinned Exact setup separately for web and Android so later runs can reuse each platform’s tools.

### Android release builds

Same-repository PRs upload a release APK for `dev.disposabl.exact.preview` with the PR’s Convex preview URL and Android’s default debug signature. Pushes to `main` upload a release APK for `dev.disposabl.exact` with the production URL and the app’s production signing key. Download the APK from the workflow run’s **Artifacts** section.

1. In **Settings → Environments**, create `android-production`. Set its deployment branches to **Selected branches and tags** and add only the branch `main`. Deployment branch rules and environment secrets are [available on GitHub Free for public repositories](https://docs.github.com/en/actions/how-tos/deploy/configure-and-manage-deployments/manage-environments).
2. Add `ANDROID_SIGNING_SETUP_TOKEN` to `android-production` as an environment secret. Use a short-lived fine-grained GitHub token restricted to this repository with **Environments: Read and write**. Once the workflow is on `main`, run **Set up Android signing** for `production`. The runner generates the keystore and saves it directly as an environment secret. Revoke the setup token and remove its secret afterward.

Once Play Console is set up, run **Set up Android signing** with `play-upload` and set the `ANDROID_PLAY_CONNECTED` environment variable to `true` in `android-production`. Main builds then also upload a signed AAB as a GitHub Actions artifact. Use the AAB for the first Play upload or use the public certificate from the setup run if Play asks for it. If Play should update existing direct-download APK installs, enroll the original production app-signing key in Play App Signing. [Play App Signing](https://developer.android.com/studio/publish/app-signing)

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
