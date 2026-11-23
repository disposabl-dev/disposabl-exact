#!/usr/bin/env bash
set -euo pipefail

: "${IOS_DISTRIBUTION_P12:?Set IOS_DISTRIBUTION_P12 to a base64-encoded distribution certificate}"
: "${IOS_DISTRIBUTION_PASSWORD:?Set IOS_DISTRIBUTION_PASSWORD}"
: "${IOS_APP_STORE_PROFILE:?Set IOS_APP_STORE_PROFILE to a base64-encoded App Store profile}"

signing_dir=$(mktemp -d "$RUNNER_TEMP/ios-store-signing.XXXXXX")
keychain="$signing_dir/signing.keychain-db"
cleanup() {
  security delete-keychain "$keychain" >/dev/null 2>&1 || true
  rm -rf "$signing_dir"
}
trap cleanup EXIT
chmod 700 "$signing_dir"
export EXACT_PROFILE="$signing_dir/app.mobileprovision"
python3 - "$signing_dir/certificate.p12" "$EXACT_PROFILE" <<'PY'
import base64, os, sys
for name, path in zip(('IOS_DISTRIBUTION_P12', 'IOS_APP_STORE_PROFILE'), sys.argv[1:]):
    with open(path, 'wb') as output:
        output.write(base64.b64decode(os.environ[name], validate=True))
    os.chmod(path, 0o600)
PY
unset IOS_DISTRIBUTION_P12 IOS_APP_STORE_PROFILE

# An App Store profile has no device list and disallows debugging.
security cms -D -i "$EXACT_PROFILE" > "$signing_dir/profile.plist"
python3 - "$signing_dir/profile.plist" <<'PY'
import datetime, plistlib, sys
with open(sys.argv[1], 'rb') as source:
    profile = plistlib.load(source)
if (profile.get('ProvisionedDevices') or profile.get('ProvisionsAllDevices') or
        profile.get('Entitlements', {}).get('get-task-allow') is not False or
        profile.get('ExpirationDate', datetime.datetime.min) <= datetime.datetime.utcnow()):
    raise SystemExit('::error::The iOS profile must be an unexpired App Store distribution profile')
PY

keychain_password=$(openssl rand -hex 24)
security create-keychain -p "$keychain_password" "$keychain"
security set-keychain-settings -lut 21600 "$keychain"
security unlock-keychain -p "$keychain_password" "$keychain"
security import "$signing_dir/certificate.p12" -k "$keychain" -P "$IOS_DISTRIBUTION_PASSWORD" -T /usr/bin/codesign >/dev/null
unset IOS_DISTRIBUTION_PASSWORD
security set-key-partition-list -S apple-tool:,apple: -s -k "$keychain_password" "$keychain" >/dev/null
security list-keychains -d user -s "$keychain"
EXACT_IDENTITY=$(security find-identity -v -p codesigning "$keychain" | awk '/"(Apple Distribution|iPhone Distribution):/ { print $2 }')
[[ "$EXACT_IDENTITY" =~ ^[A-F0-9]{40}$ ]] || { echo '::error::Expected one valid Apple Distribution signing identity'; exit 1; }
export EXACT_IDENTITY

artifacts="$RUNNER_TEMP/ios-store-artifacts"
mkdir -p "$artifacts"
export EXACT_BAKE_OUTPUT="$signing_dir/bake"
bun exact.mjs ios --device --release --archive "$artifacts/apps-store.ipa" --json > "$signing_dir/build.json"
unzip -tq "$artifacts/apps-store.ipa" >/dev/null
unzip -q "$artifacts/apps-store.ipa" -d "$signing_dir/archive"
apps=("$signing_dir"/archive/Payload/*.app)
[[ ${#apps[@]} == 1 && -f "${apps[0]}/Info.plist" ]]
codesign --verify --deep --strict "${apps[0]}"
jq -e --slurpfile expected "$RUNNER_TEMP/ios-artifacts/apps.receipt.json" '
  .platform == "ios" and .target == "aarch64-apple-ios" and
  .build.trust == "production" and .compatibilityId == $expected[0].compatibilityId
' "$artifacts/apps-store.receipt.json" >/dev/null
