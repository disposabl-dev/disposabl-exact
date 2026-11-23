#!/usr/bin/env bash
set -euo pipefail

scripts="$GITHUB_WORKSPACE/.github/scripts/hosted-mobile"
ios="$GITHUB_WORKSPACE/fixture/apps/apps"
mkdir -p "$ios/.exact"
ln -sfn "$EXACT" "$ios/.exact/checkout"
bash "$scripts/prepare-apple-exact.sh"
(cd "$ios" && bun install --frozen-lockfile)

started=$(date +%s)
(cd "$ios" && bash "$scripts/build-ios.sh") > "$RUNNER_TEMP/ios-native.log" 2>&1 &
ios_pid=$!
(cd "$NATIVE_APP_DIR" && bash "$scripts/build-android.sh") > "$RUNNER_TEMP/android-native.log" 2>&1 &
android_pid=$!
status=0
wait "$ios_pid" || status=1
wait "$android_pid" || status=1
tail -45 "$RUNNER_TEMP/ios-native.log"
tail -45 "$RUNNER_TEMP/android-native.log"
printf 'Both native processes completed in %ss\n' "$(( $(date +%s) - started ))"
exit "$status"
