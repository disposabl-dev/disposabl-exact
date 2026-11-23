#!/usr/bin/env bash
set -euo pipefail
umask 077

result=$(mktemp "$RUNNER_TEMP/appdrop-macos.XXXXXX")
trap 'rm -f "$result"' EXIT
env -u GH_TOKEN bunx --bun appdrop@0.9.0 "$RUNNER_TEMP/verified-macos/app.zip" --json > "$result"
url=$(jq -er '.url | select(test("^https://(www\\.)?appdrop\\.app/d/[A-Za-z0-9]+/?$"))' "$result")
printf '[Download macOS app](%s)\n' "$url" >> "$GITHUB_STEP_SUMMARY"
