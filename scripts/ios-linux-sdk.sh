#!/usr/bin/env bash
set -euo pipefail
# The SDK archive is private: never copy it into the public tools bundle or Actions cache.
[[ "$EXACT_IOS_SDK_URL" == https://* ]] || { echo 'ios-sdk-url must be a private HTTPS URL' >&2; exit 1; }
work=$(mktemp -d "$RUNNER_TEMP/exact-private-sdk.XXXXXX")
trap 'rm -f "$work/sdk.tar.gz"' EXIT
curl --silent --fail --location --retry 3 "$EXACT_IOS_SDK_URL" -o "$work/sdk.tar.gz"
mkdir "$work/extract"
tar -xzf "$work/sdk.tar.gz" -C "$work/extract"
sdk="$work/extract/darwin.artifactbundle"
[[ -f "$sdk/swift-sdk.json" && -x "$sdk/toolset/bin/ld64.lld" && -x "$sdk/toolset/bin/llvm-lib" ]] || { echo 'Private archive must contain a usable darwin.artifactbundle at its root' >&2; exit 1; }
echo "EXACT_APPLE_SDK=$sdk" >> "$GITHUB_ENV"
