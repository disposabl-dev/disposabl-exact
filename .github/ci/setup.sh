#!/usr/bin/env bash
set -euo pipefail
platform=${1:?Expected web, android, ios or macos}
case "$platform:${RUNNER_OS:-}:$(uname -m)" in resolve:*:*|web:Linux:x86_64|android:Linux:x86_64|ios:macOS:arm64|macos:macOS:arm64) ;; *) exit 1 ;; esac
repo=disposabl-dev/disposabl-exact
work=$(mktemp -d "${RUNNER_TEMP:-/tmp}/exact-setup.XXXXXXXX")
trap 'rm -rf "$work"' EXIT
if gh api "repos/$repo/releases/latest" > "$work/release.json" 2> "$work/error"; then
  tag=$(jq -er '.tag_name' "$work/release.json")
  [[ "$tag" =~ ^exact-ci-v1-[0-9a-f]{40}$ ]] || tag=
elif grep -q 'HTTP 404' "$work/error"; then tag=; else cat "$work/error" >&2; exit 1; fi
ref=${EXACT_REF:-${tag#exact-ci-v1-}}
if [[ -z "$ref" ]]; then ref=$(git ls-remote https://github.com/expo/exact.git refs/heads/main | cut -f1); fi
[[ "$ref" =~ ^[0-9a-f]{40}$ ]]
if [[ -n "$tag" && "$tag" != "exact-ci-v1-$ref" ]]; then
  tag="exact-ci-v1-$ref"
  if ! gh api "repos/$repo/releases/tags/$tag" > "$work/release.json" 2> "$work/error"; then
    if grep -q 'HTTP 404' "$work/error"; then tag=; else cat "$work/error" >&2; exit 1; fi
  fi
fi
if [[ "$platform" == resolve ]]; then
  printf 'exact-ref=%s\npublished=%s\n' "$ref" "$([[ -n "$tag" ]] && echo true || echo false)" >> "$GITHUB_OUTPUT"
  exit 0
fi
command -v zstd >/dev/null || { if [[ $(uname -s) == Darwin ]]; then brew install zstd; else sudo apt-get update && sudo apt-get install -y zstd; fi; }
export EXACT="$HOME/work/_temp/exact-sdk" CARGO_TARGET_DIR="$HOME/.cache/exact-native/cargo"
bash "$(dirname "$0")/checkout.sh" "$ref" "$EXACT"
(cd "$EXACT" && bun install --frozen-lockfile && git ls-files -z | xargs -0 touch -t 202001010000)
if [[ -n "$tag" ]]; then
  gh release download "$tag" -R "$repo" --pattern "cache-$platform.tar.zst.part-*" --dir "$work"
  python3 - "$work" "$platform" <<'PY'
import hashlib, json, pathlib, re, sys
root, platform = pathlib.Path(sys.argv[1]), sys.argv[2]
release = json.loads((root / 'release.json').read_text())
assets = {a['name']: a for a in release['assets'] if a['state'] == 'uploaded' and a['name'].startswith(f'cache-{platform}.tar.zst.part-')}
assert assets and not release['draft']
for name, asset in assets.items():
    assert re.fullmatch(rf'cache-{platform}\.tar\.zst\.part-[a-z]{{3}}', name)
    f = root / name
    h = hashlib.sha256()
    with f.open('rb') as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b''): h.update(chunk)
    assert f.stat().st_size == asset['size'] and asset['digest'] == 'sha256:' + h.hexdigest()
PY
  cat "$work"/cache-"$platform".tar.zst.part-* | zstd -dc | tar -xf - -C "$HOME"
else
  echo "No shared cache published yet; bootstrapping $ref."
  [[ "$platform" != web ]] || (cd "$EXACT" && cargo run --locked --manifest-path vendor/ibex/crates/hermes-lean-sys-installer/Cargo.toml -- --target x86_64-unknown-linux-gnu && bun scripts/exact.mjs setup --platform web)
fi
printf 'EXACT=%s\nEXACT_REF=%s\nCARGO_TARGET_DIR=%s\n' "$EXACT" "$ref" "$CARGO_TARGET_DIR" >> "$GITHUB_ENV"
printf 'exact-ref=%s\n' "$ref" >> "$GITHUB_OUTPUT"
