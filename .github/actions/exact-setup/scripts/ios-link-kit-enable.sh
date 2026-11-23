#!/usr/bin/env bash
# Opt-in integration for the pinned SDK. Run after other validated SDK setup.
set -euo pipefail
: "${EXACT:?}" "${SETUP_EXACT_REF:?}"
script_dir=$(cd "$(dirname "$0")" && pwd)
[[ $(git -C "$EXACT" rev-parse HEAD) == "$SETUP_EXACT_REF" ]] || { echo 'iOS SDK checkout differs from its pin' >&2; exit 1; }
hook=$(jq -ce --arg ref "$SETUP_EXACT_REF" '.[$ref]' "$script_dir/../ios-link-hooks.json")
original=$(jq -er '.original' <<< "$hook")
patched=$(jq -er '.patched' <<< "$hook")
file="$EXACT/host/apple/build.mjs"
actual=$(shasum -a 256 "$file" | awk '{print $1}')
if [[ "$actual" == "$original" ]]; then
  git -C "$EXACT" apply --check "$script_dir/ios-link-kit-test-hook.patch"
  git -C "$EXACT" apply "$script_dir/ios-link-kit-test-hook.patch"
elif [[ "$actual" != "$patched" ]]; then
  echo 'Exact iOS linker source differs from the pinned build; not enabling kit' >&2; exit 1
fi
[[ $(shasum -a 256 "$file" | awk '{print $1}') == "$patched" ]] || { echo 'Unexpected patched SDK digest' >&2; exit 1; }
