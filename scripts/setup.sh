#!/usr/bin/env bash
set -euo pipefail
cd "$EXACT"
export EXACT_TOOLS_ORIGIN=none
if [[ "$SETUP_PLATFORM" == web ]]; then
  export CHROME="$(command -v google-chrome)"
  bun scripts/exact.mjs setup --platform web
  binaryen_bin=$(bun -p 'import { BINARYEN } from "./host/web/stages.mjs"; `${process.env.HOME}/.cache/exact/binaryen/${BINARYEN.replace(" ", "_")}/bin`')
  export PATH="$binaryen_bin:$PATH"
  bun scripts/tools.mjs keep
  CARGO_INCREMENTAL=0 CARGO_PROFILE_RELEASE_DEBUG=0 CARGO_TARGET_DIR="$RUNNER_TEMP/exact-push-tools" cargo build --locked --release -p exact-bake -p exact-js-bake
  mkdir -p "$HOME/.cache/exact/publisher/$SETUP_EXACT_REF"
  cp "$RUNNER_TEMP/exact-push-tools/release/exact-bake" "$RUNNER_TEMP/exact-push-tools/release/exact-js-bake" "$HOME/.cache/exact/publisher/$SETUP_EXACT_REF/"
else
  pin=$(bun -p 'Bun.TOML.parse(await Bun.file("rust-toolchain.toml").text()).toolchain.channel')
  if [[ "$SETUP_PLATFORM" == android ]]; then
    sdkmanager="$ANDROID_HOME/cmdline-tools/latest/bin/sdkmanager"
    (set +o pipefail; yes | "$sdkmanager" --licenses >/dev/null)
    "$sdkmanager" --install 'platforms;android-37.2' 'build-tools;37.0.0' 'ndk;27.3.13750724'
    targets=(x86_64-unknown-linux-gnu aarch64-linux-android)
  else
    targets=(aarch64-apple-darwin aarch64-apple-ios aarch64-apple-ios-sim)
  fi
  rustup toolchain install "$pin" --profile minimal
  for target in "${targets[@]}"; do rustup target add --toolchain "$pin" "$target"; done
  bun install --frozen-lockfile
  cargo +"$pin" fetch --locked
  for target in "${targets[@]}"; do cargo +"$pin" run --locked --manifest-path vendor/ibex/crates/hermes-lean-sys-installer/Cargo.toml -- --target "$target"; done
fi
