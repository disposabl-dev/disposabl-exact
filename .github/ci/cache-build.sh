#!/usr/bin/env bash
# Produce disposable caches exclusively from the public Exact source and fixture.
set -euo pipefail
platform=${1:?Usage: cache-build.sh web|android|ios|macos}
[[ ${GITHUB_REPOSITORY:-} == disposabl-dev/disposabl-exact ]]
[[ ${EXACT_REF:-} =~ ^[0-9a-f]{40}$ ]]
if ! command -v zstd >/dev/null; then
  if [[ $(uname -s) == Darwin ]]; then brew install zstd; else sudo apt-get update && sudo apt-get install -y zstd; fi
fi
export EXACT="$HOME/work/_temp/exact-sdk" CARGO_TARGET_DIR="$HOME/.cache/exact-native/cargo"
mkdir -p "$(dirname "$EXACT")" "$CARGO_TARGET_DIR" "$RUNNER_TEMP/cache-output"
bash "$GITHUB_WORKSPACE/.github/ci/checkout.sh" "$EXACT_REF" "$EXACT"
(cd "$EXACT" && bun install --frozen-lockfile && git ls-files -z | xargs -0 touch -t 202001010000)
# Use a public, generated fixture rather than including any repository app data.
app="$RUNNER_TEMP/exact-cache-fixture"
(cd "$EXACT" && bun scripts/exact.mjs new "$app" --name ExactCacheSeed --bundle-id dev.disposabl.exactcacheseed)
mkdir -p "$app/.exact"
ln -sfn "$EXACT" "$app/.exact/checkout"
(cd "$app" && bun install --frozen-lockfile)
if [[ "$platform" == web ]]; then
  (cd "$EXACT" && bun scripts/exact.mjs setup --platform web && \
    CARGO_TARGET_DIR="$CARGO_TARGET_DIR/push-tools" \
      cargo build --locked --release -p exact-bake -p exact-js-bake)
  (cd "$app" && \
    CONVEX_ORIGIN=wss://public-cache.invalid CONVEX_SITE_ORIGIN=https://public-cache.invalid \
    bun exact.mjs web-build --out "$RUNNER_TEMP/public-web")
  test -s "$RUNNER_TEMP/public-web/shell.html"
else
  cd "$app"
  export CONVEX_ORIGIN=wss://public-cache.invalid CONVEX_SITE_ORIGIN=https://public-cache.invalid
  export EXACT_UPDATE_TRUST=production EXACT_UPDATE_GENESIS=1 EXACT_MOBILE_CHANNEL=base-1 EXACT_BUILD_NUMBER=1
  if [[ "$platform" == android ]]; then
    key="$RUNNER_TEMP/public-fixture.p12"
    keytool -genkeypair -noprompt -storetype PKCS12 -keystore "$key" -storepass publicfixture -keypass publicfixture -alias android -keyalg RSA -dname CN=PublicFixture -validity 2 >/dev/null 2>&1
    export ANDROID_APK_SIGNING="$(python3 - "$key" <<'PY'
import base64, json, sys
print(json.dumps({'password':'publicfixture','keystore':base64.b64encode(open(sys.argv[1],'rb').read()).decode()}))
PY
)"
  fi
  bash "$GITHUB_WORKSPACE/.github/ci/native.sh" prepare "$platform"
  bash "$GITHUB_WORKSPACE/.github/ci/native.sh" build "$platform"
fi
# Explicit allowlist: no app checkout, credentials, signing files or release output.
pin=$(bun -e 'console.log(Bun.TOML.parse(await Bun.file(process.env.EXACT + "/rust-toolchain.toml").text()).toolchain.channel)')
host=$(rustc +"$pin" -vV | awk '/^host: / { print $2 }')
paths=()
for path in ".rustup/toolchains/$pin-$host" .cargo/registry/cache .cargo/registry/index .cargo/git/db .cargo/hermes-lean-sys .cache/exact .cache/exact-native/cargo .gradle/caches/modules-2 .gradle/caches/build-cache-1 .gradle/wrapper/dists; do
  [[ ! -e "$HOME/$path" ]] || paths+=("$path")
done
(( ${#paths[@]} )) || exit 1
COPYFILE_DISABLE=1 tar -C "$HOME" -cf - --exclude=incremental --exclude='*.lock' --exclude='*.lck' --exclude='*.part' --exclude='*.ipa' --exclude='*.apk' --exclude='*.aab' --exclude='*.app' --exclude='*.receipt.json' --exclude='*.build.json' --exclude='apps-android-*' --exclude='apps_android*' --exclude='libapps_android*' --exclude='*exactcacheseed*' --exclude='*exact-cache-seed*' --exclude='bake-*' "${paths[@]}" | zstd -T0 -3 | split -b 1500000000 -a 3 - "$RUNNER_TEMP/cache-output/cache-$platform.tar.zst.part-"
archive="$RUNNER_TEMP/cache-output/cache-$platform.tar.zst"
for part in "$archive".part-*; do basename "$part"; done > "$RUNNER_TEMP/cache-output/cache-$platform.parts"
