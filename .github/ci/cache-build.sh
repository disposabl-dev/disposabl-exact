#!/usr/bin/env bash
set -euo pipefail
platform=${1:?Expected platform}
command -v zstd >/dev/null || { sudo apt-get update && sudo apt-get install -y zstd; }
[[ "$GITHUB_REPOSITORY" == disposabl-dev/disposabl-exact && "$EXACT_REF" =~ ^[0-9a-f]{40}$ ]]
export EXACT="$HOME/work/_temp/exact-sdk" CARGO_TARGET_DIR="$HOME/.cache/exact-native/cargo"
mkdir -p "$RUNNER_TEMP/cache-output" "$CARGO_TARGET_DIR"
if [[ ${CACHE_VERIFY:-} == 1 ]]; then
  cat "$RUNNER_TEMP"/restored-cache/cache-"$platform".tar.zst.part-* | zstd -dc | tar -xf - -C "$HOME"
  if [[ "$platform" == ios ]]; then
    baker=".cache/exact/ota-tools/$EXACT_REF/exact-js-bake"
    cat "$RUNNER_TEMP"/restored-cache/cache-web.tar.zst.part-* | zstd -dc | tar -xf - -C "$HOME" "$baker"
    test -x "$HOME/$baker"
    export EXACT_OTA_TOOLS_READY=1
  fi
  if [[ "$platform" == ios || "$platform" == macos ]]; then
    [[ -n $(find "$CARGO_TARGET_DIR/apple-modules" -name libexact_svg_raster.dylib -print -quit) ]]
  fi
fi
mode=
[[ "$platform" != web || ${CACHE_VERIFY:-} == 1 ]] || mode=keep-tools
bash "$GITHUB_WORKSPACE/.github/ci/setup.sh" "$platform" checkout "$mode"
app="$GITHUB_WORKSPACE/apps/apps"
export CONVEX_ORIGIN=wss://cache-check.invalid CONVEX_SITE_ORIGIN=https://cache-check.invalid
if [[ ${CACHE_VERIFY:-} != 1 ]]; then
  app="$RUNNER_TEMP/exact-cache-fixture"
  # Seed the same native capabilities as a generated app, under another identity.
  starter=$(cat "$GITHUB_WORKSPACE/packages/create-disposabl-app/starter.ref")
  git fetch --quiet --depth=1 origin "$starter"
  mkdir -p "$app"
  git archive "$starter:apps/apps" | tar -x -C "$app"
  (cd "$app" && jq '.id="dev.disposabl.exactcacheseed" | .app.id=.id | .app.name="ExactCacheSeed" | .name=.app.name | .short_name=.name' app.json > manifest.tmp && mv manifest.tmp app.json)
  sed -i 's/dev\.disposabl\.exact:\/oauth\/google/dev.disposabl.exactcacheseed:\/oauth\/google/g' "$app/auth.ts"
fi
if [[ "$platform" != web ]]; then
  export EXACT_UPDATE_CHANNEL="base-$platform-1"
  # Main ships updatable (level A) binaries. A fixed-plan fixture omits their host modules.
  key=$(node -p 'require("node:crypto").generateKeyPairSync("ed25519").publicKey.export({format:"der", type:"spki"}).subarray(-32).toString("base64")')
  (cd "$app" && jq --arg platform "$platform" --arg key "$key" '
    .deploy.store[$platform]="A" | .deploy.signing={key:"ci",keys:{ci:$key}} |
    .deploy.channel=("base-"+$platform+"-1") | .deploy.channels={(.deploy.channel):"appdrop"}
  ' app.json > manifest.tmp && mv manifest.tmp app.json)
fi
mkdir -p "$app/.exact"
ln -sfn "$EXACT" "$app/.exact/checkout"
(cd "$app" && bun install --frozen-lockfile)
if [[ "$platform" == web ]]; then
  if [[ "${CACHE_VERIFY:-}" != 1 ]]; then
    (cd "$EXACT" && cargo run --locked --manifest-path vendor/ibex/crates/hermes-lean-sys-installer/Cargo.toml -- --target x86_64-unknown-linux-gnu && \
      bun scripts/exact.mjs setup --platform web && \
      export PATH="$HOME/.cache/exact/binaryen/$(bun -p 'import { BINARYEN } from "./host/web/stages.mjs"; BINARYEN.replace(" ", "_")')/bin:$PATH" && \
      bun scripts/tools.mjs keep && git reset --mixed "$EXACT_REF")
    (cd "$EXACT" && CARGO_TARGET_DIR="$RUNNER_TEMP/ota-tools-build" cargo build --locked --release -p exact-bake -p exact-js-bake)
    ota="$HOME/.cache/exact/ota-tools/$EXACT_REF"
    mkdir -p "$ota"
    cp "$RUNNER_TEMP/ota-tools-build/release/"{exact-bake,exact-js-bake} "$ota/"
  fi
  ota="$HOME/.cache/exact/ota-tools/$EXACT_REF"
  for tool in "$ota/exact-bake" "$ota/exact-js-bake"; do
    test -x "$tool"
    ldd "$tool" | tee "$RUNNER_TEMP/ota-ldd.txt"
    ! grep -q 'not found' "$RUNNER_TEMP/ota-ldd.txt"
  done
  "$ota/exact-bake" --help >/dev/null
  # Direct compiler calls bypass the starter's before_build hook.
  (cd "$app" && bun --no-env-file scripts/locales.mjs)
  (cd "$EXACT" && "$ota/exact-js-bake" "$app" --out "$RUNNER_TEMP/ota-smoke" > "$RUNNER_TEMP/ota-receipt.json")
  test -s "$RUNNER_TEMP/ota-smoke/app.hbc"
  "$ota/exact-bake" compat "$app" --platform android --json > "$RUNNER_TEMP/ota-compat.json"
  "$ota/exact-bake" graph "$RUNNER_TEMP/ota-smoke/app.plan" "$RUNNER_TEMP/ota-compat.json" \
    "$(jq -er .target "$RUNNER_TEMP/ota-compat.json")" "$app" > "$RUNNER_TEMP/ota-graph.json"
  jq -e . "$RUNNER_TEMP/ota-graph.json" >/dev/null
  (cd "$app" && bun exact.mjs web-build --out "$RUNNER_TEMP/public-web")
  test -s "$RUNNER_TEMP/public-web/shell.html"
  paths=(.cache/exact/tools ".cache/exact/ota-tools/$EXACT_REF")
  while IFS= read -r file; do paths+=("$file"); done < <(cd "$HOME" && find .cargo/hermes-lean-sys -type f -name hermesc)
  (( ${#paths[@]} > 2 ))
else
  cd "$app"
  export EXACT_UPDATE_TRUST=production EXACT_UPDATE_GENESIS=1 EXACT_MOBILE_CHANNEL=base-1 EXACT_BUILD_NUMBER=1
  if [[ "$platform" == android ]]; then
    key="$RUNNER_TEMP/public-fixture.p12"
    keytool -genkeypair -noprompt -storetype PKCS12 -keystore "$key" -storepass publicfixture -keypass publicfixture -alias android -keyalg RSA -dname CN=PublicFixture -validity 2 >/dev/null 2>&1
    export ANDROID_APK_SIGNING="$(python3 -c 'import base64,json,sys; print(json.dumps({"password":"publicfixture","keystore":base64.b64encode(open(sys.argv[1],"rb").read()).decode()}))' "$key")"
  fi
  bash "$GITHUB_WORKSPACE/.github/ci/native.sh" prepare "$platform"
  bash "$GITHUB_WORKSPACE/.github/ci/native.sh" build "$platform" 2>&1 | tee "$RUNNER_TEMP/native-build.log"
  if [[ "${CACHE_VERIFY:-}:$platform" == 1:ios ]] && grep -Eq '[[:space:]]Compiling (exact-kernel v|ExactCore |ExactKit )' "$RUNNER_TEMP/native-build.log"; then
    echo 'The fresh iOS app rebuilt shared SDK code. Keeping the previously qualified cache.' >&2
    exit 1
  fi
  paths=()
  for file in .cargo/registry/cache .cargo/registry/index .cargo/registry/src .cargo/git/db .cargo/hermes-lean-sys .cache/exact-native/cargo .gradle/caches/modules-2 .gradle/caches/build-cache-1 .gradle/wrapper/dists; do
    [[ ! -e "$HOME/$file" ]] || paths+=("$file")
  done
fi
[[ "${CACHE_VERIFY:-}" != 1 ]] || exit 0
if [[ "$platform" == ios || "$platform" == macos ]]; then
  generated="$EXACT/host/apple/Sources/ExactCore/GeneratedBatch.swift"
  if [[ -f "$generated" ]]; then cp -p "$generated" "$CARGO_TARGET_DIR/GeneratedBatch.swift"; fi
  [[ -n $(find "$CARGO_TARGET_DIR/apple-modules" -name libexact_svg_raster.dylib -print -quit) ]] || {
    echo 'The Apple cache fixture did not compile the SVG raster module.' >&2
    exit 1
  }
fi
# Production relinks the app executable and symbols. SDK module caches are local.
tar --format pax -C "$HOME" -cf - \
  --exclude=incremental --exclude='.gradle/*.lock' --exclude=.cargo-lock --exclude='*.lck' --exclude='*.part' \
  --exclude='*.sdk' --exclude='ModuleCache*' --exclude='*-module-cache' --exclude='*.dSYM' \
  --exclude='*/release/ExactIOS' --exclude='*/release/ExactMac' --exclude='*.linked' \
  --exclude='*.ipa' --exclude='*.apk' --exclude='*.aab' --exclude='*.app' \
  --exclude='*.receipt.json' --exclude='*.build.json' --exclude='*exactcacheseed*' --exclude='*exact-cache-seed*' --exclude='bake-*' \
  "${paths[@]}" | zstd -T0 -3 | split -b 1500000000 -a 3 - "$RUNNER_TEMP/cache-output/cache-$platform.tar.zst.part-"
