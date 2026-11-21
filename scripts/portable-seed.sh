#!/usr/bin/env bash
set -euo pipefail
archive="exact-seed-${PLATFORM}.tar.zst"
cd "$RUNNER_TEMP"
if ! command -v zstd >/dev/null; then
  if [[ "$RUNNER_OS" == macOS ]]; then brew install zstd; else sudo apt-get update -q && sudo apt-get install -qy zstd; fi
fi
if [[ $1 == restore ]]; then
  gh release download "$SEED_TAG" -R disposabl-dev/disposabl-exact -p "$archive" -p "$archive.sha256"
  shasum -a 256 -c "$archive.sha256"
  zstd -dc "$archive" | tar -xf - -C /
else
  paths=()
  for path in "$HOME/.cargo/registry/index" "$HOME/.cargo/registry/cache" "$HOME/.cargo/git/db" "$HOME/.cargo/hermes-lean-sys" "$HOME/.cargo/bin/wasm-bindgen" "$HOME/.cache/exact/binaryen" "$HOME/.gradle/caches" "$HOME/.gradle/wrapper" "$BUILD_ROOT/exact-sdk/target" "$BUILD_ROOT/exact-sdk/vendor/ibex/crates/hermes-lean-sys-installer/target" "$BUILD_ROOT/apps/apps/target"; do
    [[ ! -e "$path" ]] || paths+=("${path#/}")
  done
  tar -cf - -C / "${paths[@]}" | zstd -T0 -3 -o "$archive"
  shasum -a 256 "$archive" > "$archive.sha256"
  gh release upload "$SEED_TAG" "$archive" "$archive.sha256" --clobber -R "$GITHUB_REPOSITORY"
fi
