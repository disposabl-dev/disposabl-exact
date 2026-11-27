#!/usr/bin/env bash
set -euo pipefail
platform=${1:?Expected web, android, ios or macos}
case "$platform:${RUNNER_OS:-}:$(uname -m)" in resolve:*:*|web:Linux:x86_64|android:Linux:x86_64|ios:macOS:arm64|macos:macOS:arm64) ;; *) exit 1 ;; esac
repo=disposabl-dev/disposabl-exact
work=$(mktemp -d "${RUNNER_TEMP:-/tmp}/exact-setup.XXXXXXXX")
trap 'rm -rf "$work"' EXIT
ref=${EXACT_REF:-$(git ls-remote https://github.com/expo/exact.git refs/heads/main | cut -f1)}
[[ "$ref" =~ ^[0-9a-f]{40}$ ]]
printf 'exact-ref=%s\n' "$ref" >> "$GITHUB_OUTPUT"
[[ "$platform" != resolve ]] || exit 0
tag=
if gh api "repos/$repo/releases/latest" > "$work/release.json" 2> "$work/error"; then
  tag=$(jq -r --arg prefix "exact-ci-v1-$ref-" '.tag_name | select(startswith($prefix))' "$work/release.json")
elif ! grep -q 'HTTP 404' "$work/error"; then cat "$work/error" >&2; exit 1; fi
command -v zstd >/dev/null || { if [[ $(uname -s) == Darwin ]]; then brew install zstd; else sudo apt-get update && sudo apt-get install -y zstd; fi; }
export EXACT="$HOME/work/_temp/exact-sdk" CARGO_TARGET_DIR="$HOME/.cache/exact-native/cargo"
bash "$(dirname "$0")/checkout.sh" "$ref" "$EXACT"
(cd "$EXACT" && bun install --frozen-lockfile && git ls-files -z | xargs -0 touch -t 202001010000)
if [[ -n "$tag" ]]; then
  gh release download "$tag" -R "$repo" --pattern "cache-$platform.tar.zst.part-*" --dir "$work"
  cd "$work"
  jq -er --arg platform "$platform" '
    [.assets[] | select(.name | test("^cache-" + $platform + "\\.tar\\.zst\\.part-[a-z]{3}$"))]
    | select(length > 0) | .[] | (if (.digest | test("^sha256:[a-f0-9]{64}$")) then (.digest | ltrimstr("sha256:")) else error("Missing SHA-256") end) + "  " + .name
  ' release.json > checksums
  shasum -a 256 --check --strict checksums
  cut -d ' ' -f 3 checksums | LC_ALL=C sort | while read -r part; do cat "$part"; done | zstd -dc | tar -xf - -C "$HOME"
else
  echo "No shared cache published yet; bootstrapping $ref."
  [[ "$platform" != web ]] || (cd "$EXACT" && cargo run --locked --manifest-path vendor/ibex/crates/hermes-lean-sys-installer/Cargo.toml -- --target x86_64-unknown-linux-gnu && bun scripts/exact.mjs setup --platform web)
fi
printf 'EXACT=%s\nEXACT_REF=%s\nCARGO_TARGET_DIR=%s\n' "$EXACT" "$ref" "$CARGO_TARGET_DIR" >> "$GITHUB_ENV"
