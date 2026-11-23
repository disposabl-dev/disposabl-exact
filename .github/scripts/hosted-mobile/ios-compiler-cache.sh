#!/usr/bin/env bash
set -euo pipefail
mode=$1
bundle=$2
: "${EXACT:?}" "${EXACT_APPLE_SDK:?}" "${EXACT_IOS_COMPILER_DIR:?}"
target="$EXACT_IOS_COMPILER_DIR"
key() {
  {
    git -C "$EXACT" rev-parse HEAD
    printf '%s\n' "$EXACT" "$target" "$EXACT_APPLE_SDK" "${CARGO_HOME:-$HOME/.cargo}" \
      "${EXACT_IOS_FAST_PREVIEW:-false}" "$(command -v swiftc)" "$(command -v clang)"
    rustc +1.99.1 -vV
    swiftc --version
    clang --version
    xtool --version
    sha256sum "$EXACT_APPLE_SDK/swift-sdk.json" "$EXACT_APPLE_SDK/toolset.json"
  } | sha256sum | cut -d ' ' -f 1
}
case "$mode" in
  pack)
    [[ ! -e "$bundle" && -d "$target/apple-swift" ]]
    mkdir -p "$bundle"
    key > "$bundle/compiler-key"
    paths=()
    for path in balanced x86_64-unknown-linux-gnu aarch64-apple-ios apple-swift apple-modules; do
      [[ ! -d "$target/$path" ]] || paths+=("$path")
    done
    # The seed has already removed its app crate, executables and receipts.
    # Do not publish a raw Apple SDK, and keep the compiler cache encrypted.
    tar --exclude='*.sdk' --exclude='Xcode.app' --exclude='incremental' \
      --exclude='*.p12' --exclude='*.linked' -cf - -C "$target" "${paths[@]}" \
      | zstd -T0 -1 | openssl enc -aes-256-ctr -pbkdf2 -iter 100000 \
          -pass "file:$RUNNER_TEMP/ios-cache-passphrase" -out "$bundle/compiler.tar.zst.enc"
    (cd "$bundle" && sha256sum compiler.tar.zst.enc compiler-key > SHA256SUMS)
    du -sh "$bundle"
    ;;
  restore)
    : "${EXACT_IOS_CACHE_DIGEST:?Use a pinned compiler cache archive digest}"
    private=$(mktemp -d "$RUNNER_TEMP/compiler-transfer.XXXXXX")
    trap 'rm -rf "$private"' EXIT
    for attempt in {1..30}; do
      if curl -fSs --max-time 8 "$SDK_RELAY/keys/$GITHUB_RUN_ID-$GITHUB_RUN_ATTEMPT.compiler" -o "$private/url.enc" 2>/dev/null; then
        url=$(openssl enc -d -aes-256-ctr -pbkdf2 -iter 100000 \
          -pass "file:$RUNNER_TEMP/ios-cache-passphrase" -in "$private/url.enc")
        case "$url" in
          https://*.blob.core.windows.net/*|https://*.actions.githubusercontent.com/*|https://release-assets.githubusercontent.com/*) ;;
          *) echo 'Unexpected compiler cache download host' >&2; exit 1 ;;
        esac
        if curl -fSsL --max-time 240 "$url" -o "$private/compiler.zip"; then break; fi
        rm -f "$private/compiler.zip"
      fi
      sleep 2
    done
    [[ -s "$private/compiler.zip" ]]
    printf '%s  %s\n' "$EXACT_IOS_CACHE_DIGEST" "$private/compiler.zip" | sha256sum -c -
    mkdir -p "$bundle"
    for file in compiler-key SHA256SUMS compiler.tar.zst.enc; do
      unzip -p "$private/compiler.zip" "$file" > "$bundle/$file"
    done
    [[ ! -e "$target" && "$(cat "$bundle/compiler-key")" == "$(key)" ]]
    (cd "$bundle" && sha256sum -c SHA256SUMS)
    mkdir -p "$(dirname "$target")"
    staged=$(mktemp -d "$(dirname "$target")/compiler.XXXXXX")
    trap 'rm -rf "$staged" "$private"' EXIT
    openssl enc -d -aes-256-ctr -pbkdf2 -iter 100000 \
      -pass "file:$RUNNER_TEMP/ios-cache-passphrase" -in "$bundle/compiler.tar.zst.enc" \
      | zstd -dc | tar --no-same-owner -xf - -C "$staged"
    mv "$staged" "$target"
    ;;
  *) exit 2 ;;
esac
