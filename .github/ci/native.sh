#!/usr/bin/env bash
# Run in the app directory after setup.sh supplies EXACT.
set -euo pipefail
phase=${1:?expected prepare, build, or publish}; platform=${2:?expected android, ios, or macos}
: "${RUNNER_TEMP:?}"
case "$platform" in android|ios|macos) ;; *) exit 2 ;; esac
out="$RUNNER_TEMP/$platform-artifacts"
case "$phase" in
  prepare)
    : "${EXACT:?}"
    case "$platform" in
      android)
        : "${ANDROID_HOME:?}"
        sdk="$ANDROID_HOME/cmdline-tools/latest/bin/sdkmanager"
        yes | "$sdk" --licenses >/dev/null || true
        "$sdk" 'platforms;android-37.2' 'build-tools;37.0.0' 'ndk;27.1.12297006'
        bash "$(dirname "$0")/android-tools.sh" install >/dev/null
        target=aarch64-linux-android ;;
      ios) target=aarch64-apple-ios ;;
      macos) target=aarch64-apple-darwin ;;
    esac
    pin=$(bun -e 'console.log(Bun.TOML.parse(await Bun.file(process.env.EXACT + "/rust-toolchain.toml").text()).toolchain.channel)')
    rustup toolchain install "$pin" --profile minimal --target "$target"
    host=$(rustc +"$pin" -vV | awk '/^host:/ {print $2}')
    cargo +"$pin" run --locked --manifest-path "$EXACT/vendor/ibex/crates/hermes-lean-sys-installer/Cargo.toml" -- --target "$host" --target "$target"
    ;;
  build)
    mkdir -p "$out"
    case "$platform" in
      android)
        : "${ANDROID_APK_SIGNING:?Set the standalone APK key with .github/ci/android-key.sh}" "${ANDROID_HOME:?}"
        signing=$(mktemp -d "$RUNNER_TEMP/android-signing.XXXXXX")
        gradle="$EXACT/host/android/app/build.gradle.kts"
        cleanup() { [[ ! -f "$signing/build.gradle.kts" ]] || cp -p "$signing/build.gradle.kts" "$gradle"; rm -rf "$signing"; }
        trap cleanup EXIT
        if [[ ${EXACT_ANDROID_SKIP_R8:-true} == true ]]; then
          cp -p "$gradle" "$signing/build.gradle.kts"
          python3 - "$gradle" <<'PYCODE'
from pathlib import Path
import sys
p = Path(sys.argv[1]); text = p.read_text()
old = "isMinifyEnabled = true"
if text.count(old) != 1:
    raise SystemExit("Expected one Exact Android minification setting")
p.write_text(text.replace(old, "isMinifyEnabled = false"))
PYCODE
          echo 'Exact CI: R8 disabled for this signed release APK'
        fi
        export EXACT_KEYSTORE="$signing/key.p12" EXACT_KEY_ALIAS=android EXACT_UPDATE_TRUST=production
        EXACT_KEYSTORE_PASSWORD=$(jq -er '.password | select(type == "string" and length > 0)' <<< "$ANDROID_APK_SIGNING")
        echo "::add-mask::$EXACT_KEYSTORE_PASSWORD"
        export EXACT_KEYSTORE_PASSWORD EXACT_KEY_PASSWORD="$EXACT_KEYSTORE_PASSWORD"
        jq -er '.keystore | select(type == "string" and length > 0)' <<< "$ANDROID_APK_SIGNING" | base64 --decode > "$EXACT_KEYSTORE"
        bun exact.mjs android --release --no-install --json > "$out/build.json"
        cp "$(jq -er '.path' "$out/build.json")" "$out/app.apk"
        apksigner=$(bash "$(dirname "$0")/android-tools.sh" path)
        "$apksigner" verify --print-certs "$out/app.apk" > "$signing/cert.txt"
        expected=$(keytool -exportcert -keystore "$EXACT_KEYSTORE" -storepass:env EXACT_KEYSTORE_PASSWORD -alias android | shasum -a 256 | cut -d ' ' -f 1)
        actual=$(awk -F 'certificate SHA-256 digest: ' '/certificate SHA-256 digest:/ {print tolower($NF)}' "$signing/cert.txt" | sort -u)
        [[ "$expected" =~ ^[0-9a-f]{64}$ && "$actual" == "$expected" ]] || {
          echo "APK signing key mismatch. Expected $expected. Found ${actual:-no certificate}." >&2; exit 1;
        } ;;
      ios)
        bun exact.mjs ios --device --release --unsigned --archive "$out/app.ipa" --json > "$out/build.json"
        unzip -tq "$out/app.ipa" >/dev/null ;;
      macos)
        EXACT_IDENTITY=- bun exact.mjs mac --release --json > "$out/build.json"
        bundle=$(jq -er '.path | select(endswith(".app"))' "$out/build.json")
        codesign --verify --deep --strict "$bundle"
        ditto -c -k --sequesterRsrc --keepParent "$bundle" "$out/app.zip"
        unzip -tq "$out/app.zip" >/dev/null ;;
    esac ;;
  publish)
    case "$platform" in android) file="$out/app.apk" ;; ios) file="$out/app.ipa" ;; macos) file="$out/app.zip" ;; esac
    [[ -s "$file" ]] || { echo "Missing $file" >&2; exit 1; }
    private=$(mktemp -d "$RUNNER_TEMP/appdrop.XXXXXX"); trap 'rm -rf "$private"' EXIT
    export APPDROP_HOME="$private/home"; umask 077
    # JSON includes a management credential; never print it or upload it as an artifact.
    if ! env -u GH_TOKEN bunx --bun appdrop@0.12.0 "$file" --json > "$private/result.json" 2> "$private/log"; then
      echo '::error::AppDrop upload failed (500 MiB maximum)'; exit 1
    fi
    jq -e '{url: (.url | select(test("^https://(www\\.)?appdrop\\.app/d/[A-Za-z0-9]+/?$")))}' "$private/result.json" > "$RUNNER_TEMP/installer-$platform.json" ;;
  *) exit 2 ;;
esac
