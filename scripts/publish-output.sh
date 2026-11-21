#!/usr/bin/env bash
set -euo pipefail
output=$(bun -e 'console.log(JSON.parse(await Bun.file(process.env.BUILD_JSON).text()).path)')
case "$PLATFORM" in
  web) (cd "$output" && zip -qr "$RUNNER_TEMP/web.zip" .); asset="$RUNNER_TEMP/web.zip" ;;
  android) asset="$RUNNER_TEMP/android.apk"; cp "$output" "$asset" ;;
  ios) asset="$RUNNER_TEMP/ios-unsigned.ipa"; cp "$output" "$asset" ;;
esac
gh release upload "build-$GITHUB_SHA" "$asset" --clobber -R "$GITHUB_REPOSITORY"
