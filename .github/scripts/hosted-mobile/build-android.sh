#!/usr/bin/env bash
set -euo pipefail
start=$(date +%s)
dir="$RUNNER_TEMP/verified-android"
mkdir -p "$dir"
export EXACT_UPDATE_GENESIS=1 EXACT_UPDATE_TRUST=production
export EXACT_ANDROID_APK_ONLY=1 EXACT_BAKE_OUTPUT="$dir/bake"
export EXACT_KEYSTORE="$dir/benchmark.p12" EXACT_KEY_ALIAS=benchmark
export EXACT_KEYSTORE_PASSWORD=benchmark EXACT_KEY_PASSWORD=benchmark
keytool -genkeypair -storetype PKCS12 -keystore "$EXACT_KEYSTORE" -storepass benchmark -keypass benchmark \
  -alias benchmark -keyalg RSA -keysize 2048 -validity 7 -dname 'CN=Exact benchmark'
bun "$GITHUB_WORKSPACE/.github/scripts/hosted-mobile/configure-app.mjs"
bun exact.mjs android --release --no-install --json > "$dir/build.json"
apk=$(jq -er .path "$dir/build.json")
"$ANDROID_HOME/build-tools/$ANDROID_BUILD_TOOLS_VERSION/apksigner" verify "$apk"
cp "$apk" "$dir/app.apk"
printf 'Verified signed Android APK in %ss\n' "$(( $(date +%s) - start ))"
