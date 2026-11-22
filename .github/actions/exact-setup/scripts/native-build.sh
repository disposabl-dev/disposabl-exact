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
  bun exact.mjs ios --device --release --unsigned --archive "$artifacts/apps.ipa" --json > "$artifacts/build.json"
  unzip -tq "$artifacts/apps.ipa" >/dev/null
  unzip -q "$artifacts/apps.ipa" -d "$RUNNER_TEMP/iphone-archive"
  apps=("$RUNNER_TEMP"/iphone-archive/Payload/*.app)
  [[ ${#apps[@]} == 1 && -f "${apps[0]}/Info.plist" ]]
  executable=$(python3 -c 'import plistlib,sys; print(plistlib.load(open(sys.argv[1],"rb"))["CFBundleExecutable"])' "${apps[0]}/Info.plist")
  [[ "$executable" != */* && "$executable" != . && "$executable" != .. ]]
  macho="${apps[0]}/$executable"
  file "$macho" | grep -Eq 'Mach-O 64-bit.*arm64'
  "${EXACT_APPLE_LLVM_BIN:-/usr/lib/llvm-23/bin}/llvm-objdump" --macho --private-headers "$macho" > "$RUNNER_TEMP/ios-load-commands"
  grep -Eiq '^[[:space:]]*platform[[:space:]]+(ios|2)[[:space:]]*$' "$RUNNER_TEMP/ios-load-commands"
  jq -e '.platform == "ios" and .target == "aarch64-apple-ios" and .build.trust == "production"' "$artifacts/apps.receipt.json" >/dev/null
  jq -e '.trust == "production" and .compat.target == "aarch64-apple-ios" and .compat.inputs.platform == "ios"' "$EXACT_BAKE_OUTPUT/ios-aarch64-apple-ios.build.json" >/dev/null
  [[ $(jq -r .compatibilityId "$artifacts/apps.receipt.json") == "$(jq -r .compat.id "$EXACT_BAKE_OUTPUT/ios-aarch64-apple-ios.build.json")" ]]
  exit
fi
[[ "$platform" == android ]]
if [[ "$GITHUB_EVENT_NAME" == push && -z "$ANDROID_APK_SIGNING" ]]; then
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
if [[ "$GITHUB_EVENT_NAME" == pull_request ]]; then
  build '' "$artifacts/android-preview.apk" --release --no-install
else
  build "$ANDROID_APK_SIGNING" "$artifacts/android-production.apk" --release --no-install
fi
"$ANDROID_HOME/build-tools/$ANDROID_BUILD_TOOLS_VERSION/apksigner" verify --print-certs "$artifacts/"*.apk
echo 'apk_verified=true' >> "$GITHUB_OUTPUT"
if [[ "$GITHUB_EVENT_NAME" == push && "$ANDROID_PLAY_CONNECTED" == true ]]; then
  [[ -n "$ANDROID_PLAY_UPLOAD_SIGNING" ]] || { echo '::error::Play upload signing is not configured'; exit 1; }
  EXACT_BAKE_OUTPUT="$RUNNER_TEMP/play-bake" build "$ANDROID_PLAY_UPLOAD_SIGNING" "$signing_dir/play.aab" --bundle
  evidence='select(.compat.id and .binary.sha256 and .graph.sources) | {compat, binary: .binary.sha256, sourceInputs: .binary.sourceInputs, sources: .graph.sources}'
  jq -eSc "$evidence" "$EXACT_BAKE_OUTPUT"/android-*.build.json > "$signing_dir/apk.receipt"
  jq -eSc "$evidence" "$RUNNER_TEMP/play-bake"/android-*.build.json > "$signing_dir/aab.receipt"
  cmp "$signing_dir/apk.receipt" "$signing_dir/aab.receipt"
  mv "$signing_dir/play.aab" "$artifacts/android-production.aab"
fi
