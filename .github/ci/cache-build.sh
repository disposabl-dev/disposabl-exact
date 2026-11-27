#!/usr/bin/env bash
set -euo pipefail
platform=${1:?Expected platform}
command -v zstd >/dev/null || { sudo apt-get update && sudo apt-get install -y zstd; }
[[ "$GITHUB_REPOSITORY" == disposabl-dev/disposabl-exact && "$EXACT_REF" =~ ^[0-9a-f]{40}$ ]]
export EXACT="$HOME/work/_temp/exact-sdk" CARGO_TARGET_DIR="$HOME/.cache/exact-native/cargo"
mkdir -p "$RUNNER_TEMP/cache-output" "$CARGO_TARGET_DIR"
if [[ ${CACHE_VERIFY:-} == 1 ]]; then
  cat "$RUNNER_TEMP"/restored-cache/cache-"$platform".tar.zst.part-* | zstd -dc | tar -xf - -C "$HOME"
  if [[ "$platform" == ios || "$platform" == macos ]]; then
    [[ -n $(find "$CARGO_TARGET_DIR/apple-modules" -name libexact_svg_raster.dylib -print -quit) ]]
  fi
fi
mode=
[[ "$platform" != web || ${CACHE_VERIFY:-} == 1 ]] || mode=keep-tools
bash "$GITHUB_WORKSPACE/.github/ci/checkout.sh" "$EXACT_REF" "$EXACT" ${mode:+"$mode"}
(cd "$EXACT" && bun install --frozen-lockfile && git ls-files -z | xargs -0 touch -t 202001010000)
app="$GITHUB_WORKSPACE/apps/apps"
export CONVEX_ORIGIN=wss://cache-check.invalid CONVEX_SITE_ORIGIN=https://cache-check.invalid
if [[ ${CACHE_VERIFY:-} != 1 ]]; then
  app="$RUNNER_TEMP/exact-cache-fixture"
  platforms=()
  if [[ "$platform" == ios || "$platform" == macos ]]; then platforms=(--with "$platform"); fi
  (cd "$EXACT" && bun scripts/exact.mjs new "$app" --name ExactCacheSeed --bundle-id dev.disposabl.exactcacheseed "${platforms[@]}")
  mkdir -p "$app/assets"
  if [[ "$platform" == ios || "$platform" == macos ]]; then
    # A simple SVG draws natively. A masked SVG reaches Exact’s SVG raster module.
    cat > "$app/assets/masked.svg" <<'SVG'
<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32">
  <mask id="m" style="mask-type:luminance" maskUnits="userSpaceOnUse" x="0" y="0" width="32" height="32">
    <path d="M 0 0 H 32 V 32 H 0 Z" fill="white"/>
  </mask>
  <path d="M 0 0 L 32 0 L 0 32 Z" fill="#0066cc" mask="url(#m)"/>
</svg>
SVG
    printf '%s\n' '            image "assets/masked.svg" width=32 height=32' >> "$app/app.contract"
  fi
  cp "$GITHUB_WORKSPACE/apps/apps/assets/icon.png" "$app/assets/icon.png"
  (cd "$app" && jq '.icons=[{src:"assets/icon.png",type:"image/png",sizes:"1024x1024"}] | .deploy.store.ios="0" | .deploy.store.macos="0"' app.json > manifest.tmp && mv manifest.tmp app.json)
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
  bash "$GITHUB_WORKSPACE/.github/ci/native.sh" build "$platform"
  paths=()
  for file in .cargo/registry/cache .cargo/registry/index .cargo/git/db .cargo/hermes-lean-sys .cache/exact-native/cargo .gradle/caches/modules-2 .gradle/caches/build-cache-1 .gradle/wrapper/dists; do
    [[ ! -e "$HOME/$file" ]] || paths+=("$file")
  done
fi
[[ "${CACHE_VERIFY:-}" != 1 ]] || exit 0
if [[ "$platform" == ios || "$platform" == macos ]]; then
  [[ -n $(find "$CARGO_TARGET_DIR/apple-modules" -name libexact_svg_raster.dylib -print -quit) ]] || {
    echo 'The Apple cache fixture did not compile the SVG raster module.' >&2
    exit 1
  }
fi
COPYFILE_DISABLE=1 tar --format pax -C "$HOME" -cf - --exclude=incremental --exclude='*.lock' --exclude='*.lck' --exclude='*.part' --exclude='*.sdk' --exclude='ModuleCache*' --exclude='*.ipa' --exclude='*.apk' --exclude='*.aab' --exclude='*.app' --exclude='*.receipt.json' --exclude='*.build.json' --exclude='*exactcacheseed*' --exclude='*exact-cache-seed*' --exclude='bake-*' "${paths[@]}" | zstd -T0 -3 | split -b 1500000000 -a 3 - "$RUNNER_TEMP/cache-output/cache-$platform.tar.zst.part-"
