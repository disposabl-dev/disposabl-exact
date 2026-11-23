#!/usr/bin/env bash
# GitHub Actions builds or restores the shared release. Boat runs this file by itself.
set -euo pipefail

root=$(cd "$(dirname "$0")" && pwd)
scripts="$root/scripts"

# Boat's VM runs Ubuntu 24.04. Keep the Ubuntu 26.04 runner image and its
# Exact home under /home/user so a saved snapshot includes both.
setup_boat() {
  [[ "$(uname -sm)" == 'Linux x86_64' ]]
  local ref=a55c5581c7e1a62cdee1f09367ea2909c74c7292 bun=1.4.5 version=10
  local manifest_sha=a794d5dcb85b69bbd3014415a35caec93e8fc1dda895dac87c43efeabfc12584
  local bun_sha=94559b3b528995a49452f9f2404cec74f2efd7d06e0a000a8cd214b02c3666eb
  local tag="v$version-exact-$ref-bun-$bun"
  local runner="$HOME/.local/share/exact-runner/$tag" image="disposabl/exact-ubuntu-2604:$tag"
  local bin="$HOME/.local/bin" kit="$runner/home/.exact-setup"
  mkdir -p "$kit" "$bin"
  if [[ ! -s "$runner/image.tar.zst" ]]; then
    docker build -t "$image" --build-arg BUN_VERSION="$bun" --build-arg BUN_SHA="$bun_sha" - <<'DOCKERFILE'
FROM ubuntu:26.04@sha256:0d5255be560e2d2ddcfbfda88549e9e815ef29e7cd7fc62183d5709e6e2963c6
ARG BUN_VERSION
ARG BUN_SHA
ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates curl git python3 unzip zstd \
    && curl -fsSL --retry 3 "https://github.com/oven-sh/bun/releases/download/bun-v$BUN_VERSION/bun-linux-x64.zip" -o /tmp/bun.zip \
    && echo "$BUN_SHA  /tmp/bun.zip" | sha256sum -c - \
    && unzip -p /tmp/bun.zip bun-linux-x64/bun > /usr/local/bin/bun \
    && chmod +x /usr/local/bin/bun \
    && curl -fsSL --retry 3 https://dl.google.com/linux/direct/google-chrome-stable_current_amd64.deb -o /tmp/chrome.deb \
    && apt-get install -y --no-install-recommends /tmp/chrome.deb \
    && rm -rf /tmp/bun.zip /tmp/chrome.deb /var/lib/apt/lists/*
DOCKERFILE
    docker save "$image" | zstd -f -T0 -1 -o "$runner/image.tmp.zst"
    mv "$runner/image.tmp.zst" "$runner/image.tar.zst"
  fi
  {
    echo '#!/usr/bin/env bash'
    echo 'set -euo pipefail'
    printf 'runner=%q\nimage=%q\nref=%q\n' "$runner" "$image" "$ref"
    cat <<'RUNNER'
if ! docker image inspect "$image" >/dev/null 2>&1; then
  zstd -dc "$runner/image.tar.zst" | docker load >/dev/null
fi
exec docker run --rm --init --network host --user "$(id -u):$(id -g)" \
  --env HOME=/home/runner --env EXACT=/home/runner/work/_temp/exact-sdk \
  --env "EXACT_PUBLISH_TOOLS=/home/runner/.cache/exact/publisher/$ref" \
  --env CHROME=/usr/bin/google-chrome --env EXACT_TOOLS_ORIGIN=none --env CONVEX_ORIGIN --env CONVEX_SITE_ORIGIN \
  --mount "type=bind,source=$runner/home,target=/home/runner" \
  --mount "type=bind,source=$PWD,target=$PWD" --workdir "$PWD" "$image" "$@"
RUNNER
  } > "$runner/exact-run"
  chmod +x "$runner/exact-run"
  if [[ ! -f "$runner/ready" ]]; then
    curl -fsSL --retry 3 "https://github.com/disposabl-dev/disposabl-exact/releases/download/$tag/inputs.json" -o "$kit/inputs-v$version.json"
    printf '%s  %s\n' "$manifest_sha" "$kit/inputs-v$version.json" | sha256sum -c -
    cp "$0" "$kit/install.sh"
    if ! "$runner/exact-run" env RUNNER_OS=Linux RUNNER_ARCH=X64 RUNNER_TEMP=/home/runner/.cache/exact-setup \
      GITHUB_ENV=/home/runner/.setup-env GITHUB_OUTPUT=/home/runner/.setup-output \
      SETUP_MODE=consume SETUP_PLATFORM=web SETUP_EXACT_REF="$ref" SETUP_BUN_VERSION="$bun" SETUP_BUNDLE_VERSION="$version" \
      bash /home/runner/.exact-setup/install.sh; then
      rm -rf "$runner/home/work/_temp/exact-sdk"
      return 1
    fi
  fi
  "$runner/exact-run" bun /home/runner/work/_temp/exact-sdk/scripts/exact.mjs --help >/dev/null
  touch "$runner/ready"
  install -m 755 "$runner/exact-run" "$bin/exact-run"
  echo "Exact $tag is ready. Run commands with $bin/exact-run."
}

if [[ -z "${GITHUB_ENV:-}" ]]; then
  setup_boat
  exit
fi

platform=$SETUP_PLATFORM
app_checkout=${EXACT_APP_CHECKOUT:-${GITHUB_WORKSPACE:-$PWD}}
ref=$SETUP_EXACT_REF
case "$platform:$RUNNER_OS:$RUNNER_ARCH" in
  web:Linux:X64|android:Linux:X64|ios:macOS:ARM64|ios-linux:Linux:X64) ;;
  *) echo "Unexpected runner for $platform"; exit 1 ;;
esac
[[ "$ref" =~ ^[0-9a-f]{40}$ && "$SETUP_BUN_VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]
[[ "$SETUP_BUNDLE_VERSION" =~ ^[1-9][0-9]*$ ]]

EXACT="$RUNNER_TEMP/exact-sdk"
if [[ "$RUNNER_OS" == Linux ]]; then EXACT="$HOME/work/_temp/exact-sdk"; fi
export EXACT EXACT_TOOLS_ORIGIN=none
mkdir -p "$(dirname "$EXACT")" "$RUNNER_TEMP"

prepare_tools() (
  cd "$EXACT"
  if [[ "$platform" == web ]]; then
    export CHROME="$(command -v google-chrome)"
    cargo run --locked --manifest-path vendor/ibex/crates/hermes-lean-sys-installer/Cargo.toml -- --target x86_64-unknown-linux-gnu
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
      targets=(aarch64-linux-android)
    else
      targets=(aarch64-apple-ios aarch64-apple-ios-sim)
    fi
    rust_targets=()
    for target in "${targets[@]}"; do rust_targets+=(--target "$target"); done
    rustup toolchain install "$pin" --profile minimal "${rust_targets[@]}"
    bun install --frozen-lockfile
    cargo +"$pin" fetch --locked
    cargo +"$pin" run --locked --manifest-path vendor/ibex/crates/hermes-lean-sys-installer/Cargo.toml -- "${rust_targets[@]}"
    if [[ "$SETUP_PLATFORM" == ios ]]; then
      # Seed the iOS stream with the same prebuilt publisher tools used on Linux.
      CARGO_INCREMENTAL=0 CARGO_PROFILE_RELEASE_DEBUG=0 CARGO_TARGET_DIR="$RUNNER_TEMP/exact-push-tools" cargo +"$pin" build --locked --release -p exact-bake -p exact-js-bake
      mkdir -p "$HOME/.cache/exact/publisher/$SETUP_EXACT_REF"
      cp "$RUNNER_TEMP/exact-push-tools/release/exact-bake" "$RUNNER_TEMP/exact-push-tools/release/exact-js-bake" "$HOME/.cache/exact/publisher/$SETUP_EXACT_REF/"
    fi
  fi
)

if [[ "$SETUP_MODE" == build ]]; then
  [[ ! -e "$EXACT" ]]
  if ! command -v zstd >/dev/null; then
    if [[ "$RUNNER_OS" == macOS ]]; then brew install zstd; else sudo apt-get update && sudo apt-get install -y zstd; fi
  fi
  mv "$GITHUB_WORKSPACE/.exact-sdk" "$EXACT"
  ln -s "$EXACT" "$GITHUB_WORKSPACE/.exact-sdk"
  [[ $(git -C "$EXACT" rev-parse HEAD) == "$ref" ]]
  prepare_tools
  bash "$scripts/pack.sh"
  echo "EXACT=$EXACT" >> "$GITHUB_ENV"
  echo "exact-path=$EXACT" >> "$GITHUB_OUTPUT"
  exit
fi
[[ "$SETUP_MODE" == consume ]]
if [[ $platform == ios-linux ]]; then
  if [[ -n ${EXACT_XCODE_XIP:-} ]]; then
    APPIMAGE_EXTRACT_AND_RUN=1 xtool sdk install --slim "$EXACT_XCODE_XIP"
  fi
  swiftpm=${XDG_CONFIG_HOME:+$XDG_CONFIG_HOME/swiftpm}
  export EXACT_APPLE_SDK=${EXACT_APPLE_SDK:-${swiftpm:-$HOME/.swiftpm}/swift-sdks/darwin.artifactbundle}
  if [[ ! -r "$EXACT_APPLE_SDK/swift-sdk.json" ]]; then
    echo '::error::This runner needs a Darwin Swift SDK installed by xtool. Set EXACT_APPLE_SDK or provide a local EXACT_XCODE_XIP.'
    exit 1
  fi
fi

tag="v${SETUP_BUNDLE_VERSION}-exact-${ref}-bun-$SETUP_BUN_VERSION"
release="https://github.com/disposabl-dev/disposabl-exact/releases/download/$tag"
manifest="$root/inputs-v${SETUP_BUNDLE_VERSION}.json"
staging=$(mktemp -d "$RUNNER_TEMP/exact-inputs.XXXXXX")
trap 'rm -rf "$staging"' EXIT
[[ ! -e "$EXACT" ]]
publisher=".cache/exact/publisher/$ref"
cache="$RUNNER_TEMP/exact-bundles"
cargo_target="$HOME/.cache/exact-native/cargo"
ios_tools="$RUNNER_TEMP/exact-ios-inputs"
mkdir -p "$cache" "$EXACT"
asset() {
  python3 - "$release" "$manifest" "$1" "$2" <<'PY_ASSET'
"""Download one digest-pinned public release input, in parallel for large files."""
import concurrent.futures
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import tempfile
import urllib.request

base, manifest, name, dest = sys.argv[1:]
if Path(name).name != name or not name:
    raise ValueError("Invalid release asset name")
details = json.loads(Path(manifest).read_text())[name]
size, expected = details["size"], details["sha256"]
if type(size) is not int or not 0 < size < 2_000_000_000 or not re.fullmatch("[a-f0-9]{64}", expected):
    raise ValueError("Invalid release asset metadata")
dest = Path(dest)
dest.parent.mkdir(parents=True, exist_ok=True)
url = f"{base}/{name}"

def digest(path):
    with path.open("rb") as stream:
        checksum = hashlib.sha256()
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            checksum.update(chunk)
        return checksum.hexdigest()

if dest.is_file() and dest.stat().st_size == size and digest(dest) == expected:
    sys.exit(0)
with tempfile.TemporaryDirectory(dir=dest.parent) as work:
    partial = Path(work) / "asset"
    ranged = False
    if size >= 128 * 1024**2:
        # Resolve the public GitHub release redirect once for all ranges.
        head = urllib.request.Request(url, method="HEAD", headers={"Accept-Encoding": "identity"})
        try:
            with urllib.request.urlopen(head, timeout=20) as response:
                location = response.geturl()
            with partial.open("wb") as output:
                output.truncate(size)
                def fetch(start):
                    end = min(size, start + 32 * 1024**2) - 1
                    request = urllib.request.Request(location, headers={"Range": f"bytes={start}-{end}", "Accept-Encoding":"identity"})
                    with urllib.request.urlopen(request, timeout=30) as response:
                        if response.status != 206 or response.headers.get("Content-Range") != f"bytes {start}-{end}/{size}":
                            raise ValueError("Server does not support the requested range")
                        position = start
                        while data := response.read(1024**2):
                            if position + len(data) > end + 1:
                                raise ValueError("Oversized range")
                            if os.pwrite(output.fileno(), data, position) != len(data):
                                raise OSError("Short write")
                            position += len(data)
                        if position != end + 1:
                            raise ValueError("Incomplete range")
                with concurrent.futures.ThreadPoolExecutor(max_workers=8) as pool:
                    list(pool.map(fetch, range(0, size, 32 * 1024**2)))
            ranged = True
        except (ValueError, OSError) as error:
            print(f"{name}: retrying with a single transfer ({type(error).__name__})", flush=True)
    if not ranged:
        subprocess.run(["curl", "-fsSL", "--retry", "3", "--output", str(partial), url], check=True)
    if partial.stat().st_size != size or digest(partial) != expected:
        raise ValueError(f"{name}: size or SHA-256 mismatch")
    os.replace(partial, dest)
    print(f"{name}: verified", flush=True)
PY_ASSET
}
extract() {
  local name=$1 directory=$2 file=$3
  shift 3
  asset "$name" "$file" || return 1
  mkdir -p "$directory" || return 1
  zstd -dc "$file" | tar -xf - -C "$directory" "$@"
}
source_tree() {
  extract sdk.tar.zst "$EXACT" "$staging/sdk.tar.zst"
  [[ $(git -C "$EXACT" rev-parse HEAD) == "$ref" ]]
  git -C "$EXACT" reset --hard --quiet HEAD
  (cd "$EXACT" && bun install --frozen-lockfile)
}
source_tree &
pids=($!)
bundle_platform=$platform
if [[ $platform == ios-linux ]]; then bundle_platform=web; fi
bundle="exact-$ref-$bundle_platform-$RUNNER_OS-$RUNNER_ARCH-bun-$SETUP_BUN_VERSION.tar.zst"
source_kind=release
if [[ -f "$cache/$bundle" ]]; then source_kind=cache; fi
extract "$bundle" "$HOME" "$cache/$bundle" &
pids+=($!)
case "$platform" in
  android)
    extract cargo-android.zst "$cargo_target" "$staging/cargo.zst" & pids+=($!)
    extract cargo-gradle.zst "$HOME/.gradle" "$staging/gradle.zst" & pids+=($!)
    web="exact-$ref-web-Linux-X64-bun-$SETUP_BUN_VERSION.tar.zst"
    extract "$web" "$HOME" "$staging/publisher.zst" "$publisher" & pids+=($!)
    ;;
  ios)
    mkdir -p "$ios_tools"
    extract cargo-ios.zst "$cargo_target" "$staging/cargo.zst" & pids+=($!)
    extract ios-link-kit.zst "$ios_tools/link" "$staging/link.zst" & pids+=($!)
    (extract ios-host-catalog.zst "$ios_tools/host-catalog" "$staging/host-catalog.zst" || { rm -rf "$ios_tools/host-catalog"; echo 'Host catalog unavailable; using stock or normal build.'; }) & pids+=($!)
    for file in ios-source-times.json ios-baker.json; do
      asset "$file" "$ios_tools/$file" & pids+=($!)
    done
    ;;
  web|ios-linux) ;;
  *) exit 2 ;;
esac
status=0
for pid in "${pids[@]}"; do wait "$pid" || status=1; done
[[ $status == 0 ]] || exit 1
[[ -x "$HOME/$publisher/exact-bake" && -x "$HOME/$publisher/exact-js-bake" ]]
echo "EXACT_PUBLISH_TOOLS=$HOME/$publisher" >> "$GITHUB_ENV"
echo "source=$source_kind" >> "$GITHUB_OUTPUT"
if [[ $platform == ios ]]; then
  if [[ -d /Applications/Xcode_27.2.app/Contents/Developer ]]; then
    export DEVELOPER_DIR=/Applications/Xcode_27.2.app/Contents/Developer
    echo "DEVELOPER_DIR=$DEVELOPER_DIR" >> "$GITHUB_ENV"
  fi
  bun "$scripts/ios-baker.mjs" enable "$ios_tools/ios-baker.json"
  bash "$scripts/ios-link-kit-enable.sh"
  if [[ -f "$ios_tools/link/arms/manifest.json" ]] && ! python3 "$scripts/ios-link-arms.py" restore --kit "$ios_tools/link" --target "$cargo_target"; then
    echo 'Using the standard Apple framework build for this runner.'
  fi
  # Exact chooses entries by the current package sources, dependencies and compiler flags.
  if [[ -d "$ios_tools/link/packages-kept" ]]; then
    package_root="$cargo_target/apple-swift/ios-17.0-balanced"
    mkdir -p "$package_root"
    cp -R "$ios_tools/link/packages-kept" "$package_root/"
  fi
  # Match the canonical public SDK checkout used by Cargo build scripts.
  (cd "$EXACT" && git ls-files -z | xargs -0 touch -t 202001010000)
  find "$EXACT" -type d -not -path '*/.git*' -exec touch -t 202001010000 {} +
  {
    if [[ -f "$ios_tools/host-catalog/manifest.json" ]]; then
      echo "EXACT_HOST_CATALOG=$ios_tools/host-catalog"
      echo "EXACT_LINK_KIT_PROOF=$scripts/ios-host-select.py"
    else
      echo "EXACT_LINK_KIT_PROOF=$scripts/ios-link-kit.py"
    fi
    echo "EXACT_LINK_KIT=$ios_tools/link"
    echo "EXACT_IOS_SOURCE_TIMES=$ios_tools/ios-source-times.json"
  } >> "$GITHUB_ENV"
elif [[ $platform == ios-linux ]]; then
  (
    cd "$EXACT"
    rustup target add aarch64-apple-ios
    cargo run --locked --manifest-path vendor/ibex/crates/hermes-lean-sys-installer/Cargo.toml -- --target aarch64-apple-ios
    bun scripts/exact.mjs setup --check --platform ios --device
  )
  echo "EXACT_APPLE_SDK=$EXACT_APPLE_SDK" >> "$GITHUB_ENV"
elif [[ $platform == android ]]; then
  # Resolve the pinned host plugins while Exact bakes and compiles Rust. Keep
  # Gradle's project state separate from the real app and its dependency locks.
  (
    prime="$RUNNER_TEMP/gradle-prime"
    cp -R "$EXACT/host/android" "$prime"
    metadata="$app_checkout/apps/apps/gradle-verification.xml"
    if [[ -f "$metadata" ]]; then cp "$metadata" "$prime/gradle/verification-metadata.xml"; fi
    cd "$prime"
    exec ./gradlew --offline --daemon --no-watch-fs --dependency-verification=strict help
  ) > "$RUNNER_TEMP/gradle-prime.log" 2>&1 < /dev/null &
  bash "$scripts/android-fast-profile.sh"
  echo 'org.gradle.caching=true' >> "$HOME/.gradle/gradle.properties"
  if [[ ! -f "$ANDROID_HOME/ndk/27.3.13750724/source.properties" || ! -f "$ANDROID_HOME/platforms/android-37.2/source.properties" || ! -f "$ANDROID_HOME/build-tools/37.0.0/source.properties" ]]; then
    sdkmanager="$ANDROID_HOME/cmdline-tools/latest/bin/sdkmanager"
    (set +o pipefail; yes | "$sdkmanager" --licenses >/dev/null)
    "$sdkmanager" --install 'platforms;android-37.2' 'build-tools;37.0.0' 'ndk;27.3.13750724'
  fi
  echo "ANDROID_NDK_HOME=$ANDROID_HOME/ndk/27.3.13750724" >> "$GITHUB_ENV"
  echo "ANDROID_BUILD_TOOLS_VERSION=37.0.0" >> "$GITHUB_ENV"
fi
if [[ $platform != web ]]; then
  app="$HOME/exact-native/apps/apps"
  git -C "$app_checkout" worktree add --quiet --detach "$HOME/exact-native" HEAD
  mkdir -p "$app/.exact"
  ln -s "$EXACT" "$app/.exact/checkout"
  (cd "$app" && bun install --frozen-lockfile)
  {
    echo "NATIVE_APP_DIR=$app"
    echo "CARGO_TARGET_DIR=$cargo_target"
    echo 'CARGO_PROFILE_RELEASE_LTO=off'
    echo 'CARGO_PROFILE_RELEASE_CODEGEN_UNITS=16'
    echo 'CARGO_PROFILE_BALANCED_LTO=off'
    echo 'CARGO_PROFILE_SIZE_LTO=off'
  } >> "$GITHUB_ENV"
fi

echo "EXACT=$EXACT" >> "$GITHUB_ENV"
echo "exact-path=$EXACT" >> "$GITHUB_OUTPUT"
