#!/usr/bin/env bash
set -euo pipefail

scripts="$GITHUB_WORKSPACE/.github/scripts/hosted-mobile"
seed="$RUNNER_TEMP/ios-cache-seed"
output="$RUNNER_TEMP/ios-cache-seed-output"
cache="$RUNNER_TEMP/ios-target"
[[ ! -e "$cache" && ! -e "$seed" && ! -e "$output" ]]
git -C "$GITHUB_WORKSPACE" worktree add --quiet --detach "$seed" HEAD
trap 'git -C "$GITHUB_WORKSPACE" worktree remove --force "$seed"' EXIT
cd "$seed/apps/apps"
mkdir -p .exact
ln -s "$EXACT" .exact/checkout
bun install --frozen-lockfile
EXACT_IOS_ARTIFACT_DIR="$output" bash "$scripts/build-ios.sh"

# Discard the seed's native crate, staged app, and bake receipts. Keep the
# dependency build units and SwiftPM scratch that Exact shares across apps.
workspace=.exact/shells/Cargo.toml
package=$(cargo metadata --manifest-path "$workspace" --format-version 1 --no-deps \
  | jq -er '[.packages[] | select(.name | endswith("-apple"))] | if length == 1 then .[0].name else error("Expected one seed Apple crate") end')
CARGO_TARGET_DIR="$cache" cargo clean --manifest-path "$workspace" --profile balanced --target aarch64-apple-ios -p "$package"
test -d "$cache/apple-swift"
find "$cache/apple-swift" -type f \( -name 'ExactIOS' -o -name '*.linked' \) -delete
rm -rf "$cache/clients" "$cache/bake-compiled" "$cache/bake-metadata" "$cache/.exact-crates" "$output"
du -sh "$cache"
