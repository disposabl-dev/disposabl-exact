#!/usr/bin/env bash
set -euo pipefail

scripts="$GITHUB_WORKSPACE/.github/scripts/hosted-mobile"
seed="$RUNNER_TEMP/ios-cache-seed"
output="$RUNNER_TEMP/ios-cache-seed-output"
cache="${EXACT_IOS_COMPILER_DIR:-$RUNNER_TEMP/ios-target}"
[[ ! -e "$cache" && ! -e "$seed" && ! -e "$output" ]]
git -C "$GITHUB_WORKSPACE" worktree add --quiet --detach "$seed" HEAD
trap 'git -C "$GITHUB_WORKSPACE" worktree remove --force "$seed"' EXIT
cd "$seed/apps/apps"
mkdir -p .exact
ln -s "$EXACT" .exact/checkout
bun install --frozen-lockfile
jq '.app.id = "dev.disposabl.compilerseed" | .id = .app.id' app.json > app.cache-seed.json
mv app.cache-seed.json app.json
IOS_PRIME_PUBLIC_CAPABILITIES="${EXACT_IOS_PRIME_PUBLIC_CAPABILITIES:-false}" \
  EXACT_IOS_ARTIFACT_DIR="$output" EXACT_IOS_COMPILER_DIR="$cache" bash "$scripts/build-ios.sh"

# Discard the seed's native crate, staged app, and bake receipts. Keep the
# dependency build units and SwiftPM scratch that Exact shares across apps.
CARGO_TARGET_DIR="$cache" bun -e '
  const { resolveApp, injectedProfiles, platformCrateKind } = await import(process.env.EXACT + "/scripts/app.mjs");
  const app = resolveApp(process.cwd());
  const packageName = app.crate(platformCrateKind(app.dir, "ios"));
  const clean = Bun.spawnSync(["cargo", "clean", ...injectedProfiles(app), "--profile", "balanced",
    "--target", "aarch64-apple-ios", "-p", packageName], { cwd: app.workspace, stdout: "inherit", stderr: "inherit" });
  process.exit(clean.exitCode);
'
test -d "$cache/apple-swift"
find "$cache/apple-swift" -type f \( -name 'ExactIOS' -o -name '*.linked' \) -delete
rm -rf "$cache/clients" "$cache/bake-compiled" "$cache/bake-metadata" "$cache/.exact-crates" "$output"
du -sh "$cache"
