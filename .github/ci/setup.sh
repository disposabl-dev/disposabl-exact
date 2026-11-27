#!/usr/bin/env bash
# Restore the latest successfully published, app-independent Exact cache.
set -euo pipefail
platform=${1:?Usage: setup.sh web|android|ios|macos}
case "$platform:${RUNNER_OS:-}:$(uname -m)" in
  web:Linux:x86_64|android:Linux:x86_64) cache=$platform ;;
  ios:macOS:arm64) cache=ios ;;
  macos:macOS:arm64) cache=macos ;;
  *) echo "Unsupported Exact platform/runner: $platform ${RUNNER_OS:-} $(uname -m)" >&2; exit 1 ;;
esac
if ! command -v zstd >/dev/null; then
  if [[ $(uname -s) == Darwin ]]; then brew install zstd; else sudo apt-get update && sudo apt-get install -y zstd; fi
fi
repo=disposabl-dev/disposabl-exact
work=$(mktemp -d "${RUNNER_TEMP:-/tmp}/exact-setup.XXXXXXXX")
trap 'rm -rf "$work"' EXIT
# Verify each cache download against GitHub's release asset digest.
fetch() {
  local tag=$1 name=$2 dest=$3 api digest
  api="https://api.github.com/repos/$repo/releases/tags/$tag"
  curl -fsSL --retry 3 "$api" -o "$work/release.json" || return 1
  digest=$(python3 - "$work/release.json" "$name" <<'PY'
import json, re, sys
release = json.load(open(sys.argv[1]))
a = next((x for x in release.get('assets', []) if x['name'] == sys.argv[2] and x['state'] == 'uploaded'), None)
if release.get('draft') or not a or not re.fullmatch(r'sha256:[0-9a-f]{64}', a.get('digest') or ''):
    sys.exit(1)
print(a['digest'][7:])
PY
  ) || return 1
  curl -fsSL --retry 3 "https://github.com/$repo/releases/download/$tag/$name" -o "$dest" || return 1
  [[ $(shasum -a 256 "$dest" | cut -d ' ' -f1) == "$digest" ]]
}
status=$(curl -sSL --retry 3 -o "$work/pointer.json" -w '%{http_code}' "https://api.github.com/repos/$repo/releases/tags/exact-ci-latest")
case "$status" in
  200) ref=$(python3 - "$work/pointer.json" <<'PY2'
import json, re, sys
release = json.load(open(sys.argv[1]))
ref = release.get('body', '').strip()
if release.get('draft') or release.get('tag_name') != 'exact-ci-latest' or not re.fullmatch('[0-9a-f]{40}', ref):
    sys.exit('Invalid published cache pointer')
print(ref)
PY2
  ) ;;
  404) ref= ;;
  *) echo "Cache pointer lookup failed: HTTP $status" >&2; exit 1 ;;
esac
if [[ -z "$ref" && "$status" == 404 ]]; then
  echo 'Shared cache unavailable; resolving the current upstream Exact revision.'
  ref=$(git ls-remote https://github.com/expo/exact.git refs/heads/main | cut -f1)
fi
[[ "$ref" =~ ^[0-9a-f]{40}$ ]] || { echo 'Invalid Exact revision' >&2; exit 1; }
exact="$HOME/work/_temp/exact-sdk"
bash "$(dirname "$0")/checkout.sh" "$ref" "$exact"
export EXACT="$exact" CARGO_TARGET_DIR="$HOME/.cache/exact-native/cargo"
mkdir -p "$CARGO_TARGET_DIR"
if [[ "$status" == 200 ]]; then
  fetch "exact-ci-$ref" "cache-$cache.parts" "$work/parts" || { echo "Published $cache cache index failed verification" >&2; exit 1; }
  : > "$work/cache.tar.zst"
  count=0
  while IFS= read -r part; do
    [[ "$part" =~ ^cache-${cache}\.tar\.zst\.part-[a-z]{3}$ ]] || { echo 'Invalid cache part name' >&2; exit 1; }
    fetch "exact-ci-$ref" "$part" "$work/part" || { echo "Published cache part failed verification: $part" >&2; exit 1; }
    cat "$work/part" >> "$work/cache.tar.zst"
    count=$((count + 1))
  done < "$work/parts"
  (( count > 0 )) || { echo 'Empty cache index' >&2; exit 1; }
  zstd -dc "$work/cache.tar.zst" | tar -xf - -C "$HOME"
  echo "Restored shared $cache cache for $ref"
fi
(cd "$exact" && bun install --frozen-lockfile && git ls-files -z | xargs -0 touch -t 202001010000)
if [[ "$platform" == web ]]; then
  (cd "$exact" && bun scripts/exact.mjs setup --platform web)
fi
if [[ -n "${GITHUB_ENV:-}" ]]; then
  printf 'EXACT=%s\nEXACT_REF=%s\nCARGO_TARGET_DIR=%s\n' "$EXACT" "$ref" "$CARGO_TARGET_DIR" >> "$GITHUB_ENV"
fi
if [[ -n "${GITHUB_OUTPUT:-}" ]]; then printf 'exact-ref=%s\n' "$ref" >> "$GITHUB_OUTPUT"; fi
