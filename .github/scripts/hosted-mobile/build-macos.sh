#!/usr/bin/env bash
set -euo pipefail

scripts="$GITHUB_WORKSPACE/.github/scripts/hosted-mobile"
dir="$RUNNER_TEMP/verified-macos"
mkdir -p .exact "$dir"
ln -sfn "$EXACT" .exact/checkout
bun install --frozen-lockfile
bash "$scripts/prepare-apple-exact.sh" macos
bun "$scripts/configure-app.mjs"
export EXACT_UPDATE_GENESIS=1 EXACT_UPDATE_TRUST=production EXACT_IDENTITY=-
export CARGO_TARGET_DIR="$RUNNER_TEMP/macos-target"
start=$(date +%s)
bun exact.mjs mac --release --bundle --distribution --ad-hoc --json > "$dir/build.json"
app=$(jq -er '.path | select(endswith(".app"))' "$dir/build.json")
test -f "$app/Contents/Info.plist"
executable=$(python3 -c 'import plistlib,sys; print(plistlib.load(open(sys.argv[1],"rb"))["CFBundleExecutable"])' "$app/Contents/Info.plist")
[[ "$executable" != */* && "$executable" != . && "$executable" != .. ]]
"$EXACT_APPLE_LLVM_BIN/llvm-lipo" "$app/Contents/MacOS/$executable" -verify_arch arm64
"$EXACT_APPLE_LLVM_BIN/llvm-objdump" --macho --private-headers "$app/Contents/MacOS/$executable" > "$dir/load-commands"
grep -Eiq '^[[:space:]]*platform[[:space:]]+(macos|1)[[:space:]]*$' "$dir/load-commands"
(cd "$(dirname "$app")" && zip -q -r -y "$dir/app.zip" "$(basename "$app")")
unzip -tq "$dir/app.zip"
printf 'Verified macOS arm64 ZIP in %ss\n' "$(( $(date +%s) - start ))"
