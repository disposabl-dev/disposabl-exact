#!/usr/bin/env bash
set -euo pipefail
platform=$1
artifacts="$RUNNER_TEMP/${platform}-artifacts"
if [[ "$platform" == ios-link ]]; then
  private_dir=$(mktemp -d "$RUNNER_TEMP/appdrop.XXXXXX")
  trap 'rm -rf "$private_dir"' EXIT
  if ! npx --yes appdrop@0.8 "$RUNNER_TEMP/ios-artifacts/apps.ipa" --json > "$private_dir/result.json" 2> "$private_dir/log"; then
    echo '::error::AppDrop upload failed'; exit 1
  fi
  url=$(jq -er '.url | select(test("^https://(www\\.)?appdrop\\.app/d/[A-Za-z0-9]+/?$"))' "$private_dir/result.json") || { echo '::error::AppDrop returned an invalid install URL'; exit 1; }
  printf '[Install the iPhone app](%s)\n' "$url" >> "$GITHUB_STEP_SUMMARY"
  exit
fi
[[ "$CONVEX_ORIGIN" == wss://* ]] || { echo '::error::Invalid Convex WebSocket origin'; exit 1; }
mkdir -p "$artifacts/bake"
if [[ "$platform" == ios ]]; then
  verify_ios_binary() {
    local binary=$1
    # Both device and simulator binaries can report arm64.
    "$EXACT_APPLE_LLVM_BIN/llvm-lipo" "$binary" -verify_arch arm64
    "$EXACT_APPLE_LLVM_BIN/llvm-objdump" --macho --private-headers "$binary" > "$RUNNER_TEMP/ios-load-commands"
    grep -Eiq '^[[:space:]]*platform[[:space:]]+(ios|2)[[:space:]]*$' "$RUNNER_TEMP/ios-load-commands"
  }
  probe=$(mktemp -d "$RUNNER_TEMP/ios-sdk-probe.XXXXXX")
  printf 'import SwiftUI\nprint(Text("Exact"))\n' > "$probe/main.swift"
  bun "$EXACT/host/apple/toolchain.mjs" --sdk iphoneos swiftc \
    -target arm64-apple-ios17.0 "$probe/main.swift" -o "$probe/probe"
  verify_ios_binary "$probe/probe"
  rm -rf "$probe"
  bun exact.mjs ios --device --release --unsigned --archive "$artifacts/apps.ipa" --json > "$artifacts/build.json"
  unzip -tq "$artifacts/apps.ipa" >/dev/null
  unzip -q "$artifacts/apps.ipa" -d "$RUNNER_TEMP/iphone-archive"
  apps=("$RUNNER_TEMP"/iphone-archive/Payload/*.app)
  [[ ${#apps[@]} == 1 && -f "${apps[0]}/Info.plist" ]]
  executable=$(python3 -c 'import plistlib,sys; print(plistlib.load(open(sys.argv[1],"rb"))["CFBundleExecutable"])' "${apps[0]}/Info.plist")
  [[ "$executable" != */* && "$executable" != . && "$executable" != .. ]]
  verify_ios_binary "${apps[0]}/$executable"
  receipt="$artifacts/apps.receipt.json"
  bake="$EXACT_BAKE_OUTPUT/ios-aarch64-apple-ios.build.json"
  jq -e --slurpfile bake "$bake" '
    .platform == "ios" and .target == "aarch64-apple-ios" and
    .build.trust == "production" and .compatibilityId == $bake[0].compat.id and
    .build == $bake[0] and $bake[0].compat.target == "aarch64-apple-ios" and
    $bake[0].compat.inputs.platform == "ios"
  ' "$receipt" >/dev/null
  jq -e --slurpfile receipt "$receipt" '
    .platform == "ios" and .target == "aarch64-apple-ios" and
    .compatibilityId == $receipt[0].compatibilityId and .build.trust == "production"
  ' "${apps[0]}/receipt.json" >/dev/null
  exit
fi
[[ "$platform" == android ]]
[[ "${DEPLOY_TARGET:-}" == preview || "${DEPLOY_TARGET:-}" == production ]] || { echo '::error::Invalid deployment target'; exit 1; }
if [[ "$DEPLOY_TARGET" == production && -z "$ANDROID_APK_SIGNING" ]]; then
  echo '::error::Production Android signing is not configured'; exit 1
fi
signing_dir=$(mktemp -d "$RUNNER_TEMP/android-signing.XXXXXX")
trap 'rm -rf "$signing_dir"' EXIT
build() (
  signing=$1 output=$2
  shift 2
  if [[ -n "$signing" ]]; then
    export EXACT_KEYSTORE="$signing_dir/signing.p12" EXACT_KEY_ALIAS=android
    EXACT_KEYSTORE_PASSWORD=$(jq -er '.password' <<< "$signing")
    echo "::add-mask::$EXACT_KEYSTORE_PASSWORD"
    export EXACT_KEYSTORE_PASSWORD EXACT_KEY_PASSWORD="$EXACT_KEYSTORE_PASSWORD"
    jq -er '.keystore' <<< "$signing" | base64 --decode > "$EXACT_KEYSTORE"
  fi
  bun exact.mjs android "$@" --json > "$signing_dir/build.json"
  cp "$(jq -er '.path' "$signing_dir/build.json")" "$output"
)
if [[ "$DEPLOY_TARGET" == preview ]]; then
  build '' "$artifacts/android-preview.apk" --release --no-install
else
  build "$ANDROID_APK_SIGNING" "$artifacts/android-production.apk" --release --no-install
fi
"$ANDROID_HOME/build-tools/$ANDROID_BUILD_TOOLS_VERSION/apksigner" verify --print-certs "$artifacts/"*.apk
echo 'apk_verified=true' >> "$GITHUB_OUTPUT"
if [[ "$DEPLOY_TARGET" == production ]]; then
  aab_signing=$ANDROID_APK_SIGNING
  if [[ "${ANDROID_PLAY_CONNECTED:-}" == true ]]; then
    [[ -n "${ANDROID_PLAY_UPLOAD_SIGNING:-}" ]] || { echo '::error::Play upload signing is not configured'; exit 1; }
    aab_signing=$ANDROID_PLAY_UPLOAD_SIGNING
  fi
  EXACT_BAKE_OUTPUT="$RUNNER_TEMP/play-bake" build "$aab_signing" "$signing_dir/play.aab" --bundle
  # Compare exactly the frozen cohort Exact signs into the update stream.
  bun -e '
    import { readFileSync, readdirSync } from "node:fs";
    import { resolve } from "node:path";
    const { cohortReceipt } = await import(resolve(process.env.EXACT, "scripts/deploy-heads.mjs"));
    const { canonicalJson } = await import(resolve(process.env.EXACT, "scripts/deploy-signing.mjs"));
    const read = dir => {
      const files = readdirSync(dir).filter(name => /^android-.*\.build\.json$/.test(name)).sort();
      if (!files.length) throw Error("Missing Android build receipt");
      return files.map(name => {
        const build = JSON.parse(readFileSync(resolve(dir, name), "utf8"));
        if (build.trust !== "production" || build.compat?.inputs?.platform !== "android") throw Error("Invalid Android production receipt");
        return cohortReceipt(build);
      });
    };
    const apk = read(process.env.EXACT_BAKE_OUTPUT), bundle = read(process.env.RUNNER_TEMP + "/play-bake");
    if (canonicalJson(apk) !== canonicalJson(bundle)) throw Error("APK and AAB update cohorts differ");
  '
  mv "$signing_dir/play.aab" "$artifacts/android-production.aab"
fi
