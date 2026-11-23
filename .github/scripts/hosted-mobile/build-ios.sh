#!/usr/bin/env bash
set -euo pipefail

start=$(date +%s)
export EXACT_UPDATE_GENESIS=1 EXACT_UPDATE_TRUST=production
export EXACT_BAKE_OUTPUT="$RUNNER_TEMP/ios-bake"
export CARGO_TARGET_DIR="$RUNNER_TEMP/ios-target"
unset CARGO_PROFILE_RELEASE_LTO CARGO_PROFILE_RELEASE_CODEGEN_UNITS CARGO_PROFILE_BALANCED_LTO CARGO_PROFILE_SIZE_LTO
bun "$GITHUB_WORKSPACE/.github/scripts/hosted-mobile/configure-app.mjs"
ipa="$RUNNER_TEMP/verified-ios/apps.ipa"
mkdir -p "$(dirname "$ipa")"
bun exact.mjs ios --device --release --unsigned --no-install --archive "$ipa"
unzip -tq "$ipa"
unpacked=$(mktemp -d "$RUNNER_TEMP/ipa.XXXXXX")
trap 'rm -rf "$unpacked"' EXIT
unzip -q "$ipa" -d "$unpacked"
apps=("$unpacked"/Payload/*.app)
[[ ${#apps[@]} == 1 && -f "${apps[0]}/Info.plist" ]]
[[ -z "$(find "$unpacked" -name embedded.mobileprovision -print -quit)" ]]
exe=$(python3 -c 'import plistlib,sys; print(plistlib.load(open(sys.argv[1],"rb"))["CFBundleExecutable"])' "${apps[0]}/Info.plist")
[[ "$exe" != */* && "$exe" != . && "$exe" != .. ]]
"$EXACT_APPLE_LLVM_BIN/llvm-lipo" "${apps[0]}/$exe" -verify_arch arm64
"$EXACT_APPLE_LLVM_BIN/llvm-objdump" --macho --private-headers "${apps[0]}/$exe" > "$unpacked/load-commands"
grep -Ein '^[[:space:]]*platform[[:space:]]+(ios|2)[[:space:]]*$' "$unpacked/load-commands"
rcodesign print-signature-info --config-file /dev/null "${apps[0]}/$exe" > "$unpacked/signature"
grep -q 'CodeSignatureFlags(.*ADHOC' "$unpacked/signature"
grep -Eq '^[[:space:]]*cms: null[[:space:]]*$' "$unpacked/signature"
printf 'Verified unsigned arm64 iPhone IPA in %ss\n' "$(( $(date +%s) - start ))"
