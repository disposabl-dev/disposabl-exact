# Disposabl Exact

Starter kit for building apps and agents.

## Build from this template

Use **Use this template → Create a new repository**. Clone the generated repository, edit the heading in `apps/apps/app.contract`, and push to `main`. The first edit starts parallel web, Android, and iOS builds. Web restores Exact’s prebuilt Linux compiler. Android and iOS restore their compiled starter caches from the canonical repository's [seed release](https://github.com/disposabl-dev/disposabl-exact/releases/tag/exact-seed-v1-f40a26b9). Subsequent pushes restore the generated repository's own Actions cache when available.

Open **Releases** in the generated repository for the commit's `web.zip`, `android.apk`, and `ios-unsigned.ipa`. Extract the web archive onto a static web host. The iOS archive requires signing before installation on a device.

Starter maintainers can publish the three cache archives using **Actions → Publish portable build seeds → Run workflow**.

## Enable automatic updates in a generated repo

Enable GitHub Pages from the root of a `gh-pages` branch containing `.nojekyll`. Create a separate Ed25519 signing key for each app. From the generated app repository, with `EXACT` pointing to the pinned SDK checkout, run:

```sh
key_id="app-updates"
key_dir="$HOME/.config/exact/keys/$(gh repo view --json nameWithOwner -q .nameWithOwner)"
public_key=$(bun "$EXACT/scripts/deploy.mjs" keygen "$key_id" --keys "$key_dir" --json | jq -r .publicKey)
gh secret set EXACT_OTA_SIGNING_KEY < "$key_dir/$key_id.pem"
node scripts/configure-updates.mjs "$(gh api 'repos/{owner}/{repo}/pages' --jq .html_url)" "$key_id" "$public_key"
gh variable set EXACT_OTA_ENABLED --body true
git add apps/apps/app.json
git commit -m '[native] Enable signed updates'
git push origin main
```

The first build publishes a base APK and unsigned IPA. Its production receipts initialize both update streams. Later app edits on `main` publish a web build and signed updates for compatible installed mobile apps. The Pages site serves the web app at its root and the download links at `downloads/`. Keep the private key outside Git. The publisher compares changes with the signed compatibility receipt of each installed base. It requests a replacement binary for affected platforms when native inputs change. A `[native]` commit forces fresh builds. Android requires a stable APK signing key for in-place binary upgrades. OTA signing uses a separate key.

## Monorepo layout

- `apps/apps` for the Exact app
- `packages/backend` for the Convex backend

## Planned features

1. Authentication with Google sign-in
2. Payments with Autumn.js on the web and in-app purchases on Android, macOS, and iOS
