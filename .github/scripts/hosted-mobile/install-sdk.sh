#!/usr/bin/env bash
set -euo pipefail
umask 077

private="$RUNNER_TEMP/sdk-private"
mkdir -m 700 "$private"
trap 'rm -rf "$private" "$RUNNER_TEMP/sdk-recipient.key"' EXIT
url="$SDK_RELAY/keys/$GITHUB_RUN_ID-$GITHUB_RUN_ATTEMPT-$BENCHMARK_APP"
for attempt in {1..180}; do
  if curl -fSs --max-time 8 "$url" -o "$private/wrapped" 2>/dev/null; then break; fi
  sleep 2
done
[[ -s "$private/wrapped" ]] || { echo 'The SDK relay did not authorize this runner'; exit 1; }
openssl pkeyutl -decrypt -inkey "$RUNNER_TEMP/sdk-recipient.key" -in "$private/wrapped" \
  -pkeyopt rsa_padding_mode:oaep -pkeyopt rsa_oaep_md:sha256 > "$private/material"
mapfile -t material < "$private/material"
[[ ${material[0]} =~ ^[0-9a-f]{64}$ && ${material[1]} =~ ^[0-9a-f]{64}$ ]]
printf '%s\n' "${material[0]}" > "$private/passphrase"
curl -fSs --retry 3 --max-time 240 "$SDK_RELAY/sdk.tar.zst.enc" -o "$private/sdk.enc"
printf '%s  %s\n' "${material[1]}" "$private/sdk.enc" | sha256sum -c -
openssl enc -d -aes-256-ctr -pbkdf2 -iter 100000 -pass "file:$private/passphrase" -in "$private/sdk.enc" \
  | zstd -dc | tar --no-same-owner -xf - -C "$private"
xtool --version
xtool sdk install "$private/darwin.xtoolsdk"
xtool sdk status
sdk=${XDG_CONFIG_HOME:+$XDG_CONFIG_HOME/swiftpm}
sdk="${sdk:-$HOME/.swiftpm}/swift-sdks/darwin.artifactbundle"
jq -e '.targetTriples["arm64-apple-ios"].sdkRootPath' "$sdk/swift-sdk.json" >/dev/null
printf 'EXACT_APPLE_SDK=%s\n' "$sdk" >> "$GITHUB_ENV"
