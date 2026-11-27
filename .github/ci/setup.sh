#!/usr/bin/env bash
set -euo pipefail
platform=${1:?Expected web, android, ios or macos}
case "$platform:${RUNNER_OS:-}:$(uname -m)" in web:Linux:x86_64|android:Linux:x86_64|ios:Linux:x86_64|macos:Linux:x86_64) ;; *) exit 1 ;; esac
phase=${2:-all}
case "$phase" in all|checkout|restore) ;; *) echo "Unknown setup phase $phase" >&2; exit 2 ;; esac
ref=${EXACT_REF:?Expected upstream Exact commit}
[[ "$ref" =~ ^[0-9a-f]{40}$ ]]
export EXACT="$HOME/work/_temp/exact-sdk" CARGO_TARGET_DIR="$HOME/.cache/exact-native/cargo"
if [[ "$phase" != restore ]]; then
  bash "$(dirname "$0")/checkout.sh" "$ref" "$EXACT"
  (cd "$EXACT" && bun install --frozen-lockfile && git ls-files -z | xargs -0 touch -t 202001010000)
  printf 'EXACT=%s\nEXACT_REF=%s\nCARGO_TARGET_DIR=%s\n' "$EXACT" "$ref" "$CARGO_TARGET_DIR" >> "$GITHUB_ENV"
fi
[[ "$phase" != checkout ]] || exit 0
repo=disposabl-dev/disposabl-exact
work=$(mktemp -d "${RUNNER_TEMP:-/tmp}/exact-setup.XXXXXXXX")
trap 'rm -rf "$work"' EXIT
gh api "repos/$repo/releases?per_page=100" | jq --arg prefix "exact-ci-linux-v2-$platform-$ref-" \
  'first(.[] | select(.draft == false and (.tag_name | startswith($prefix)))) // {}' > "$work/release.json"
tag=$(jq -r '.tag_name // empty' "$work/release.json")
command -v zstd >/dev/null || { sudo apt-get update && sudo apt-get install -y zstd; }
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
