#!/usr/bin/env bash
# Run from the Exact app directory. setup.sh supplies EXACT and optional caches.
set -euo pipefail
phase=${1:?usage: native.sh prepare|build|publish android|ios|macos}
platform=${2:?usage: native.sh prepare|build|publish android|ios|macos}
: "${RUNNER_TEMP:?}"
case "$platform" in android|ios|macos) ;; *) echo "Unknown platform: $platform" >&2; exit 2 ;; esac
out="$RUNNER_TEMP/$platform-artifacts"
case "$phase" in
  prepare)
    : "${EXACT:?}"
    case "$platform" in
      android)
        [[ "$(uname -s)" == Linux ]] || { echo 'Android requires Linux' >&2; exit 1; }
        : "${ANDROID_HOME:?}"
        sdkmanager="$ANDROID_HOME/cmdline-tools/latest/bin/sdkmanager"
        # sdkmanager can close its input early after accepting all licenses.
        yes | "$sdkmanager" --licenses >/dev/null || true
        "$sdkmanager" 'platforms;android-37.2' 'build-tools;37.0.0' 'ndk;27.1.12297006'
        target=aarch64-linux-android ;;
      ios|macos)
        [[ "$(uname -s):$(uname -m)" == Darwin:arm64 ]] || { echo 'Apple builds require Apple Silicon macOS' >&2; exit 1; }
        if [[ "$platform" == ios ]]; then target=aarch64-apple-ios; else target=aarch64-apple-darwin; fi ;;
    esac
    pin=$(bun -e 'console.log(Bun.TOML.parse(await Bun.file(process.env.EXACT + "/rust-toolchain.toml").text()).toolchain.channel)')
    rustup toolchain install "$pin" --profile minimal --target "$target"
    bun install --frozen-lockfile --cwd "$EXACT"
    cargo +"$pin" run --locked --manifest-path "$EXACT/vendor/ibex/crates/hermes-lean-sys-installer/Cargo.toml" -- --target "$target"
    cargo +"$pin" fetch --locked --manifest-path "$EXACT/Cargo.toml"
    options=(); [[ "$platform" == ios ]] && options=(--device)
    bun "$EXACT/scripts/exact.mjs" setup --check --platform "$platform" "${options[@]}"
    ;;
  build)
    : "${EXACT:?}"
    mkdir -p "$out"
    case "$platform" in
      android)
        : "${ANDROID_APK_SIGNING:?Production APK signing is required}"
        export EXACT_UPDATE_TRUST=production
        signing=$(mktemp -d "$RUNNER_TEMP/android-signing.XXXXXX")
        trap 'rm -rf "$signing"' EXIT
        export EXACT_KEYSTORE="$signing/key.p12" EXACT_KEY_ALIAS=android
        EXACT_KEYSTORE_PASSWORD=$(jq -er '.password | select(type == "string" and length > 0)' <<< "$ANDROID_APK_SIGNING")
        echo "::add-mask::$EXACT_KEYSTORE_PASSWORD"
        export EXACT_KEYSTORE_PASSWORD EXACT_KEY_PASSWORD="$EXACT_KEYSTORE_PASSWORD"
        jq -er '.keystore | select(type == "string" and length > 0)' <<< "$ANDROID_APK_SIGNING" | base64 --decode > "$EXACT_KEYSTORE"
        bun exact.mjs android --release --no-install --json > "$out/build.json"
        cp "$(jq -er '.path' "$out/build.json")" "$out/app.apk"
        "$ANDROID_HOME/build-tools/37.0.0/apksigner" verify --print-certs "$out/app.apk" > "$signing/cert.txt"
        expected=$(keytool -list -v -keystore "$EXACT_KEYSTORE" -storepass:env EXACT_KEYSTORE_PASSWORD -alias android | sed -n 's/^[[:space:]]*SHA256: //p' | head -1 | tr -d ':' | tr '[:upper:]' '[:lower:]')
        actual=$(sed -n 's/^Signer #1 certificate SHA-256 digest: //p' "$signing/cert.txt" | tr '[:upper:]' '[:lower:]')
        [[ "$expected" =~ ^[0-9a-f]{64}$ && "$actual" == "$expected" && $(grep -c 'certificate SHA-256 digest:' "$signing/cert.txt") == 1 ]] || { echo 'APK signing key mismatch' >&2; exit 1; }
        ;;
      ios)
        bun exact.mjs ios --device --release --unsigned --archive "$out/app.ipa" --json > "$out/build.json"
        unzip -tq "$out/app.ipa" >/dev/null
        ;;
      macos)
        export EXACT_IDENTITY=-
        bun exact.mjs mac --release --json > "$out/build.json"
        bundle=$(jq -er '.path | select(endswith(".app"))' "$out/build.json")
        codesign --verify --deep --strict "$bundle"
        ditto -c -k --sequesterRsrc --keepParent "$bundle" "$out/app.zip"
        unzip -tq "$out/app.zip" >/dev/null
        ;;
    esac
    ;;
  publish)
    case "$platform" in android) file="$out/app.apk" ;; ios) file="$out/app.ipa" ;; macos) file="$out/app.zip" ;; esac
    [[ -s "$file" ]] || { echo "Missing $file" >&2; exit 1; }
    # JSON contains the private management key. Persist it only to a private file;
    # the caller must save it to a secret store, never an artifact or job summary.
    private=$(mktemp -d "$RUNNER_TEMP/appdrop.XXXXXX")
    trap 'rm -rf "$private"' EXIT
    export APPDROP_HOME="$private/home"
    umask 077
    if ! env -u GH_TOKEN bunx --bun appdrop@0.12.0 "$file" --json > "$private/result.json" 2> "$private/log"; then
      echo '::error::AppDrop upload failed'; exit 1
    fi
    jq -e '.url | select(test("^https://(www\\.)?appdrop\\.app/d/[A-Za-z0-9]+/?$"))' "$private/result.json" >/dev/null
    jq -e '.manageKey | select(type == "string" and length > 0)' "$private/result.json" >/dev/null
    jq '{url, id, manageKey}' "$private/result.json" > "$RUNNER_TEMP/installer-$platform.private.json"
    jq '{url}' "$private/result.json" > "$RUNNER_TEMP/installer-$platform.json"
    ;;
  *) echo "Unknown phase: $phase" >&2; exit 2 ;;
esac
