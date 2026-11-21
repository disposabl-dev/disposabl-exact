#!/usr/bin/env bash
set -euo pipefail
output=$(bun -e 'console.log(JSON.parse(await Bun.file(process.env.BUILD_JSON).text()).path)')
case "$PLATFORM" in
  web) (cd "$output" && zip -qr "$RUNNER_TEMP/web.zip" .); asset="$RUNNER_TEMP/web.zip" ;;
  android) asset="$RUNNER_TEMP/android.apk"; cp "$output" "$asset" ;;
  ios) asset="$RUNNER_TEMP/ios-unsigned.ipa"; mkdir -p "$RUNNER_TEMP/ipa/Payload"; cp -R "$output" "$RUNNER_TEMP/ipa/Payload/"; (cd "$RUNNER_TEMP/ipa" && zip -qry "$asset" Payload); unzip -l "$asset" | grep -q "Payload/.*\.app/" ;;
esac
gh release upload "build-$GITHUB_SHA" "$asset" --clobber -R "$GITHUB_REPOSITORY"
