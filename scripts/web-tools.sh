#!/usr/bin/env bash
set -euo pipefail
asset=web-tools-linux-x64.tar.zst
case "$1" in
  restore)
    work=$(mktemp -d)
    trap 'rm -rf "$work"' EXIT
    cd "$work"
    gh release download "$SEED_TAG" -R disposabl-dev/disposabl-exact -p "$asset" -p "$asset.sha256"
    sha256sum -c "$asset.sha256"
    mkdir -p "$HOME/.cache/exact"
    zstd -dc "$asset" | tar -xf - -C "$HOME/.cache/exact"
    ;;
  publish)
    (cd "$EXACT" && bun scripts/tools.mjs keep)
    cd "$RUNNER_TEMP"
    tar -cf - -C "$HOME/.cache/exact" tools | zstd -T0 -3 -f -o "$asset"
    sha256sum "$asset" > "$asset.sha256"
    gh release upload "$SEED_TAG" "$asset" "$asset.sha256" --clobber -R "$GITHUB_REPOSITORY"
    ;;
  *) exit 2 ;;
esac
