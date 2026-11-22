#!/usr/bin/env bash
set -euo pipefail
command -v zstd >/dev/null || { sudo apt-get update && sudo apt-get install -y zstd; }
asset="exact-${SETUP_EXACT_REF}-${SETUP_PLATFORM}-${RUNNER_OS}-${RUNNER_ARCH}-bun-${SETUP_BUN_VERSION}.tar.zst"
tag="v${SETUP_BUNDLE_VERSION}-exact-${SETUP_EXACT_REF}-bun-${SETUP_BUN_VERSION}"
work=$(mktemp -d "$RUNNER_TEMP/exact-setup.XXXXXX")
trap 'rm -rf "$work"' EXIT
bundles="$RUNNER_TEMP/exact-bundles"
mkdir -p "$bundles"
if [[ -f "$bundles/$asset" && -f "$bundles/$asset.sha256" ]]; then
  source_kind=cache
elif gh release download "$tag" --repo disposabl-dev/disposabl-exact --pattern "$asset" --pattern "$asset.sha256" --dir "$work"; then
  mv "$work/$asset" "$work/$asset.sha256" "$bundles/"
  source_kind=release
else
  echo "::error::Could not download $asset from disposabl-dev/disposabl-exact release $tag. The template's Publish shared Exact tools workflow publishes these assets."
  exit 1
fi
(cd "$bundles" && shasum -a 256 -c "$asset.sha256")
zstd -dc "$bundles/$asset" | tar -xf - -C "$HOME"
echo "Exact $SETUP_PLATFORM setup: $source_kind"
(cd "$EXACT" && bun install --frozen-lockfile)
echo "EXACT=$EXACT" >> "$GITHUB_ENV"
if [[ "$SETUP_PLATFORM" == web ]]; then
  echo "EXACT_PUBLISH_TOOLS=$HOME/.cache/exact/publisher/${SETUP_EXACT_REF}" >> "$GITHUB_ENV"
fi
if [[ "$SETUP_PLATFORM" == android ]]; then
  sdkmanager="$ANDROID_HOME/cmdline-tools/latest/bin/sdkmanager"
  if [[ ! -x "$sdkmanager" ]]; then sdkmanager=$(command -v sdkmanager); fi
  if [[ ! -f "$ANDROID_HOME/ndk/27.3.13750724/source.properties" || ! -f "$ANDROID_HOME/platforms/android-37.2/source.properties" || ! -f "$ANDROID_HOME/build-tools/37.0.0/source.properties" ]]; then
    (set +o pipefail; yes | "$sdkmanager" --licenses >/dev/null)
    "$sdkmanager" --install "platforms;android-37.2" "build-tools;37.0.0" "ndk;27.3.13750724"
  fi
  echo "ANDROID_NDK_HOME=$ANDROID_HOME/ndk/27.3.13750724" >> "$GITHUB_ENV"
  echo "ANDROID_BUILD_TOOLS_VERSION=37.0.0" >> "$GITHUB_ENV"
fi
echo "source=$source_kind" >> "$GITHUB_OUTPUT"
