#!/usr/bin/env bash
set -euo pipefail
cd "$EXACT"
paths=()
if [[ "$SETUP_PLATFORM" == web ]]; then
  paths=(.cache/exact/tools ".cache/exact/publisher/$SETUP_EXACT_REF")
else
  pin=$(bun -p 'Bun.TOML.parse(await Bun.file("rust-toolchain.toml").text()).toolchain.channel')
  case "$RUNNER_OS:$RUNNER_ARCH" in Linux:X64) triple=x86_64-unknown-linux-gnu;; macOS:ARM64) triple=aarch64-apple-darwin;; *) exit 1;; esac
  paths=(".rustup/toolchains/$pin-$triple" .cargo/hermes-lean-sys .cargo/registry/cache .cargo/registry/index .cargo/git/db)
fi
present=()
for path in "${paths[@]}"; do [[ ! -e "$HOME/$path" ]] || present+=("$path"); done
[[ ${#present[@]} -gt 0 ]]
asset="exact-${SETUP_EXACT_REF}-${SETUP_PLATFORM}-${RUNNER_OS}-${RUNNER_ARCH}-bun-${SETUP_BUN_VERSION}.tar.zst"
tar -cf - -C "$HOME" "${present[@]}" | zstd -T0 -1 -o "$RUNNER_TEMP/$asset"
size=$(wc -c < "$RUNNER_TEMP/$asset")
(( size < 2000000000 )) || { echo "Bundle exceeds 2 GB: $size" >&2; exit 1; }
(cd "$RUNNER_TEMP" && shasum -a 256 "$asset" > "$asset.sha256")
