#!/usr/bin/env bash
# Run once from the app repository with GitHub CLI and OpenSSL.
set -euo pipefail
repo=$(gh repo view --json nameWithOwner --jq .nameWithOwner)
env_name=android-production
dir=$(mktemp -d)
trap 'rm -rf "$dir"' EXIT
if ! gh api "repos/$repo/environments/$env_name" >/dev/null 2>"$dir/error"; then
  grep -q 'HTTP 404' "$dir/error" || { cat "$dir/error" >&2; exit 1; }
  gh api --method PUT "repos/$repo/environments/$env_name" >/dev/null
fi
names=$(gh secret list --repo "$repo" --env "$env_name" --json name --jq '.[].name')
if grep -Fxq EXACT_UPDATE_SEED <<< "$names"; then echo 'Using the existing update key.'; exit 0; fi
openssl rand -base64 32 | gh secret set EXACT_UPDATE_SEED --repo "$repo" --env "$env_name"
