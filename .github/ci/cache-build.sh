#!/usr/bin/env bash
set -euo pipefail
platform=${1:?Expected platform}
command -v zstd >/dev/null || { if [[ $(uname -s) == Darwin ]]; then brew install zstd; else sudo apt-get update && sudo apt-get install -y zstd; fi; }
[[ "$GITHUB_REPOSITORY" == disposabl-dev/disposabl-exact && "$EXACT_REF" =~ ^[0-9a-f]{40}$ ]]
export EXACT="$HOME/work/_temp/exact-sdk" CARGO_TARGET_DIR="$HOME/.cache/exact-native/cargo"
mkdir -p "$RUNNER_TEMP/cache-output" "$CARGO_TARGET_DIR"
bash "$GITHUB_WORKSPACE/.github/ci/checkout.sh" "$EXACT_REF" "$EXACT"
(cd "$EXACT" && bun install --frozen-lockfile && git ls-files -z | xargs -0 touch -t 202001010000)
app="$RUNNER_TEMP/exact-cache-fixture"
(cd "$EXACT" && bun scripts/exact.mjs new "$app" --name ExactCacheSeed --bundle-id dev.disposabl.exactcacheseed)
mkdir -p "$app/.exact"; ln -sfn "$EXACT" "$app/.exact/checkout"
mkdir -p "$app/assets"
cp "$GITHUB_WORKSPACE/apps/apps/assets/icon.png" "$app/assets/icon.png"
bun -e 'const p = process.argv[1], app = await Bun.file(p).json(); app.icons = [{src:"assets/icon.png", type:"image/png", sizes:"1024x1024"}]; await Bun.write(p, JSON.stringify(app, null, 2));' "$app/app.json"
(cd "$app" && bun install --frozen-lockfile)
if [[ "$platform" == web ]]; then
  if [[ "${CACHE_VERIFY:-}" != 1 ]]; then
    (cd "$EXACT" && cargo run --locked --manifest-path vendor/ibex/crates/hermes-lean-sys-installer/Cargo.toml -- --target x86_64-unknown-linux-gnu && \
      bun scripts/exact.mjs setup --platform web && \
      export PATH="$HOME/.cache/exact/binaryen/$(bun -p 'import { BINARYEN } from "./host/web/stages.mjs"; BINARYEN.replace(" ", "_")')/bin:$PATH" && \
      bun scripts/tools.mjs keep)
  fi
  (cd "$app" && bun exact.mjs web-build --out "$RUNNER_TEMP/public-web")
  test -s "$RUNNER_TEMP/public-web/shell.html"
  paths=(.cache/exact/tools)
  while IFS= read -r file; do paths+=("$file"); done < <(cd "$HOME" && find .cargo/hermes-lean-sys -type f -name hermesc)
  (( ${#paths[@]} > 1 ))
else
  cd "$app"
  bun -e 'const p = "app.json", app = await Bun.file(p).json(); app.deploy ??= {}; app.deploy.store ??= {}; app.deploy.store.ios = "0"; app.deploy.store.macos = "0"; await Bun.write(p, JSON.stringify(app, null, 2));'
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
COPYFILE_DISABLE=1 tar -C "$HOME" -cf - --exclude=incremental --exclude='*.lock' --exclude='*.lck' --exclude='*.part' --exclude='*.sdk' --exclude='ModuleCache*' --exclude=apple-modules --exclude='*.ipa' --exclude='*.apk' --exclude='*.aab' --exclude='*.app' --exclude='*.receipt.json' --exclude='*.build.json' --exclude='*exactcacheseed*' --exclude='*exact-cache-seed*' --exclude='bake-*' "${paths[@]}" | zstd -T0 -3 | split -b 1500000000 -a 3 - "$RUNNER_TEMP/cache-output/cache-$platform.tar.zst.part-"
