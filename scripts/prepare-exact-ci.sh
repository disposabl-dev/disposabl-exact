#!/usr/bin/env bash
set -euo pipefail

platform=$1
cd "$EXACT"

if [[ $platform == web ]]; then
  export CHROME="$(command -v google-chrome)"
  bun scripts/exact.mjs setup --platform web
  exit
fi

case "$platform" in
  android)
    sdkmanager="$ANDROID_HOME/cmdline-tools/latest/bin/sdkmanager"
    sdk_packages=('platforms;android-37.2' 'build-tools;37.0.0' 'ndk;27.1.12297006')
    if [[ ! -f $ANDROID_HOME/platforms/android-37.2/source.properties ||
          ! -f $ANDROID_HOME/build-tools/37.0.0/source.properties ||
          ! -f $ANDROID_HOME/ndk/27.1.12297006/source.properties ]]; then
      (set +o pipefail; yes | "$sdkmanager" --licenses >/dev/null)
      "$sdkmanager" --install "${sdk_packages[@]}"
    fi
    echo "ANDROID_NDK_HOME=$ANDROID_HOME/ndk/27.1.12297006" >> "$GITHUB_ENV"
    target=aarch64-linux-android
    ;;
  linux)
    sudo apt-get update -q
    sudo apt-get install -qy --no-install-recommends \
      pkg-config clang libudev-dev libinput-dev libdrm-dev libgbm-dev \
      libxkbcommon-dev libfontconfig1-dev libfreetype-dev libwayland-dev
    target=x86_64-unknown-linux-gnu
    ;;
  ios) target=aarch64-apple-ios ;;
  macos) target=aarch64-apple-darwin ;;
  windows) target=x86_64-pc-windows-msvc ;;
  *) printf 'Unknown platform %s\n' "$platform" >&2; exit 2 ;;
esac

pin=$(bun -e 'console.log(Bun.TOML.parse(await Bun.file("rust-toolchain.toml").text()).toolchain.channel)')
rustup toolchain install "$pin" --profile minimal --target "$target" --no-self-update
bun install --frozen-lockfile
cargo +"$pin" run --locked --manifest-path vendor/ibex/crates/hermes-lean-sys-installer/Cargo.toml -- --target "$target"
cargo +"$pin" fetch --locked
