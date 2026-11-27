#!/usr/bin/env bash
set -euo pipefail
platform=${1:?Expected web, android, ios or macos}
case "$platform:${RUNNER_OS:-}:$(uname -m)" in web:Linux:x86_64|android:Linux:x86_64|ios:Linux:x86_64|macos:Linux:x86_64) ;; *) exit 1 ;; esac
phase=${2:-all}
case "$phase" in all|checkout|restore|ota) ;; *) echo "Unknown setup phase $phase" >&2; exit 2 ;; esac
ref=${EXACT_REF:?Expected upstream Exact commit}
[[ "$ref" =~ ^[0-9a-f]{40}$ ]]
export EXACT="$HOME/work/_temp/exact-sdk" CARGO_TARGET_DIR="$HOME/.cache/exact-native/cargo"
if [[ "$phase" == all || "$phase" == checkout ]]; then
  bash "$(dirname "$0")/checkout.sh" "$ref" "$EXACT"
  (cd "$EXACT" && bun install --frozen-lockfile && git ls-tree -rtz --name-only HEAD | xargs -0 touch -ch -t 202001010000 &&
    git ls-files -z -- ':(glob)**/Cargo.toml' | xargs -0r touch -ch -t 202001010000.01)
  printf 'EXACT=%s\nEXACT_REF=%s\nCARGO_TARGET_DIR=%s\n' "$EXACT" "$ref" "$CARGO_TARGET_DIR" >> "$GITHUB_ENV"
fi
[[ "$phase" != checkout ]] || exit 0
repo=disposabl-dev/disposabl-exact
work=$(mktemp -d "${RUNNER_TEMP:-/tmp}/exact-setup.XXXXXXXX")
trap 'rm -rf "$work"' EXIT
tag=$(jq -er --arg platform "$platform" '.[$platform]' <<< "${EXACT_CACHE_TAGS:?Expected verified platform cache tags}")
command -v zstd >/dev/null || { sudo apt-get update && sudo apt-get install -y zstd; }
[[ "$tag" =~ ^exact-ci-linux-v2-$platform-$ref-[0-9]+-[0-9]+$ ]]
gh api "repos/$repo/releases/tags/$tag" > "$work/release.json"
gh release download "$tag" -R "$repo" --pattern "cache-$platform.tar.zst.part-*" --dir "$work"
cd "$work"
jq -er --arg platform "$platform" '
  [.assets[] | select(.name | test("^cache-" + $platform + "\\.tar\\.zst\\.part-[a-z]{3}$"))]
  | select(length > 0) | .[] | (if (.digest | test("^sha256:[a-f0-9]{64}$")) then (.digest | ltrimstr("sha256:")) else error("Missing SHA-256") end) + "  " + .name
' release.json > checksums
sha256sum --check --strict checksums
cut -d ' ' -f 3 checksums | LC_ALL=C sort | while read -r part; do cat "$part"; done | zstd -dc | tar -xf - -C "$HOME"
if [[ "$phase" == ota ]]; then echo "EXACT_OTA_TOOLS_READY=1" >> "$GITHUB_ENV"; fi
