#!/usr/bin/env bash
set -euo pipefail
output=$(bun -e 'console.log(JSON.parse(await Bun.file(process.env.BUILD_JSON).text()).path)')
case "$PLATFORM" in
  web) (cd "$output" && zip -qr "$RUNNER_TEMP/web.zip" .); asset="$RUNNER_TEMP/web.zip" ;;
  android) asset="$RUNNER_TEMP/android.apk"; cp "$output" "$asset" ;;
  ios) asset="$RUNNER_TEMP/ios-unsigned.ipa"; mkdir -p "$RUNNER_TEMP/ipa/Payload"; cp -R "$output" "$RUNNER_TEMP/ipa/Payload/"; (cd "$RUNNER_TEMP/ipa" && zip -qry "$asset" Payload); unzip -l "$asset" | grep -q "Payload/.*\.app/" ;;
esac
gh release upload "${RELEASE_TAG:-build-$GITHUB_SHA}" "$asset" --clobber -R "$GITHUB_REPOSITORY"

if [[ -d "$RUNNER_TEMP/ota-base" ]]; then
  # Export the capability receipt used by Exact to initialize a signed stream.
  bun -e '
    const { readdirSync, readFileSync, writeFileSync } = require("node:fs");
    const dir = process.env.RUNNER_TEMP + "/ota-base";
    const platform = process.env.PLATFORM;
    const candidates = readdirSync(dir).filter(name => name.endsWith(".build.json"))
      .map(name => JSON.parse(readFileSync(dir + "/" + name)))
      .filter(r => r.trust === "production" && r.compat?.inputs?.platform === platform && r.compat?.inputs?.store?.L === "A");
    if (candidates.length !== 1) throw Error("Expected one production update receipt for " + platform);
    const {version, trust, compat, graph, binary} = candidates[0];
    writeFileSync(process.env.RUNNER_TEMP + "/" + platform + ".build.json", JSON.stringify({
      version, trust, compat, graph, binary: { sha256: binary.sha256, sourceInputs: binary.sourceInputs }
    }));
  '
  gh release upload "${RELEASE_TAG:-build-$GITHUB_SHA}" "$RUNNER_TEMP/$PLATFORM.build.json" --clobber -R "$GITHUB_REPOSITORY"
fi
