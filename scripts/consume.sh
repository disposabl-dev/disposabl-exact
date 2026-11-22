#!/usr/bin/env bash
set -euo pipefail
[[ "$SETUP_EXACT_REF" =~ ^[0-9a-f]{40}$ ]] || { echo 'exact-ref must be a full lowercase commit SHA' >&2; exit 1; }
[[ "$SETUP_BUN_VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || exit 1
[[ "$SETUP_RELEASE_REPO" =~ ^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$ ]] || exit 1
case "$SETUP_PLATFORM:$RUNNER_OS:$RUNNER_ARCH" in web:Linux:X64|android:Linux:X64|ios:macOS:ARM64|ios:Linux:X64) ;; *) echo 'Unsupported platform/runner combination' >&2; exit 1;; esac
command -v zstd >/dev/null || { if [[ "$RUNNER_OS" == macOS ]]; then brew install zstd; else sudo apt-get update && sudo apt-get install -y zstd; fi; }
asset="exact-${SETUP_EXACT_REF}-${SETUP_PLATFORM}-${RUNNER_OS}-${RUNNER_ARCH}-bun-${SETUP_BUN_VERSION}.tar.zst"
format=$(cat "$SETUP_ACTION_DIR/bundle-version")
tag="v${format}-exact-${SETUP_EXACT_REF}-bun-${SETUP_BUN_VERSION}"
work=$(mktemp -d "$RUNNER_TEMP/exact-setup.XXXXXX")
trap 'rm -rf "$work"' EXIT
# Both the TS baker and its Hermes compiler retain build-time paths.
export EXACT="$RUNNER_TEMP/exact-sdk"
mv "$GITHUB_WORKSPACE/.exact-sdk" "$EXACT"
ln -s "$EXACT" "$GITHUB_WORKSPACE/.exact-sdk"
[[ $(git -C "$EXACT" rev-parse HEAD) == "$SETUP_EXACT_REF" ]] || { echo 'Wrong Exact checkout' >&2; exit 1; }
source_kind=source
bundles="$RUNNER_TEMP/exact-bundles"
mkdir -p "$bundles"
if [[ -f "$bundles/$asset" && -f "$bundles/$asset.sha256" ]]; then
  source_kind=cache
elif gh release download "$tag" --repo "$SETUP_RELEASE_REPO" --pattern "$asset" --pattern "$asset.sha256" --dir "$work"; then
  mv "$work/$asset" "$work/$asset.sha256" "$bundles/"
  source_kind=release
else
  echo 'No matching release; setting up from source.'
  bash "$SETUP_ACTION_DIR/scripts/setup.sh"
fi
if [[ "$source_kind" != source ]]; then
  (cd "$bundles" && shasum -a 256 -c "$asset.sha256")
  zstd -dc "$bundles/$asset" | tar -xf - -C "$HOME"
fi
echo "Exact $SETUP_PLATFORM setup: $source_kind"
(cd "$EXACT" && bun install --frozen-lockfile)
echo "EXACT=$EXACT" >> "$GITHUB_ENV"
if [[ "$SETUP_PLATFORM" == web ]]; then
  echo "EXACT_PUBLISH_TOOLS=$HOME/.cache/exact/publisher/${SETUP_EXACT_REF}" >> "$GITHUB_ENV"
fi
if [[ "$SETUP_PLATFORM:$RUNNER_OS" == ios:Linux ]]; then
  bash "$SETUP_ACTION_DIR/scripts/ios-linux-tools.sh"
  bash "$SETUP_ACTION_DIR/scripts/ios-linux-sdk.sh"
elif [[ "$SETUP_PLATFORM" == ios ]]; then
  if [[ -d /Applications/Xcode_27.2.app/Contents/Developer ]]; then
    export DEVELOPER_DIR=/Applications/Xcode_27.2.app/Contents/Developer
    echo "DEVELOPER_DIR=$DEVELOPER_DIR" >> "$GITHUB_ENV"
  fi
  xcodebuild -version
  xcrun --sdk iphoneos --show-sdk-version
fi
if [[ "$SETUP_PLATFORM" == android ]]; then
  sdkmanager="$ANDROID_HOME/cmdline-tools/latest/bin/sdkmanager"
  if [[ ! -f "$ANDROID_HOME/ndk/27.3.13750724/source.properties" || ! -f "$ANDROID_HOME/platforms/android-37.2/source.properties" || ! -f "$ANDROID_HOME/build-tools/37.0.0/source.properties" ]]; then
    (set +o pipefail; yes | "$sdkmanager" --licenses >/dev/null)
    "$sdkmanager" --install "platforms;android-37.2" "build-tools;37.0.0" "ndk;27.3.13750724"
  fi
  echo "ANDROID_NDK_HOME=$ANDROID_HOME/ndk/27.3.13750724" >> "$GITHUB_ENV"
  echo "ANDROID_BUILD_TOOLS_VERSION=37.0.0" >> "$GITHUB_ENV"
fi
echo "exact-path=$EXACT" >> "$GITHUB_OUTPUT"
echo "source=$source_kind" >> "$GITHUB_OUTPUT"
