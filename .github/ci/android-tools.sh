#!/usr/bin/env bash
# Install or locate the highest stable Android SDK Build Tools version.
set -euo pipefail
: "${ANDROID_HOME:?Set ANDROID_HOME to the Android SDK root}"
action=${1:-path}
case "$action" in
  install)
    sdk="$ANDROID_HOME/cmdline-tools/latest/bin/sdkmanager"
    [[ -x "$sdk" ]] || { echo "Missing sdkmanager: $sdk" >&2; exit 1; }
    # Ignore preview packages (e.g. 37.0.0-rc1) and repository headings.
    version=$("$sdk" --sdk_root="$ANDROID_HOME" --list | awk '
      { package = $1
        if (package ~ /^build-tools[;\/][0-9]+\.[0-9]+\.[0-9]+$/) {
          sub(/^build-tools[;\/]/, "", package); print package
        } }
    ' | sort -Vu | tail -n 1)
    [[ -n "$version" ]] || { echo 'No stable Android Build Tools found in SDK repository' >&2; exit 1; }
    "$sdk" --sdk_root="$ANDROID_HOME" "build-tools;$version" >&2
    [[ -x "$ANDROID_HOME/build-tools/$version/apksigner" ]] || { echo "Missing apksigner in Build Tools $version" >&2; exit 1; }
    printf '%s\n' "$ANDROID_HOME/build-tools/$version/apksigner" ;;
  path)
    version=$(find "$ANDROID_HOME/build-tools" -mindepth 1 -maxdepth 1 -type d -exec basename {} \; 2>/dev/null | awk '/^[0-9]+\.[0-9]+\.[0-9]+$/' | sort -V | tail -n 1)
    [[ -n "$version" && -x "$ANDROID_HOME/build-tools/$version/apksigner" ]] || { echo 'No installed stable Android Build Tools with apksigner' >&2; exit 1; }
    printf '%s\n' "$ANDROID_HOME/build-tools/$version/apksigner" ;;
  *) echo "Usage: $0 [install|path]" >&2; exit 2 ;;
esac
