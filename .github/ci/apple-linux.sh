#!/usr/bin/env bash
# Sourced by native.sh. The SDK layout follows xTool v2's Darwin artifact bundle.
apple_linux() (
  set -euo pipefail
  phase=$1
  platform=$2
  ci_dir=$3
  root=${EXACT_APPLE_ROOT:-$RUNNER_TEMP/exact-apple}
  . /etc/os-release
  [[ "$ID" == ubuntu && "$VERSION_ID" =~ ^(24|26)\.04$ && $(uname -m) == x86_64 ]] || {
    echo 'Apple cross-builds require x86_64 Ubuntu 24.04 or 26.04.' >&2
    exit 1
  }
  case "$platform" in
    ios)
      version=27.1 system=iPhoneOS triple=arm64-apple-ios runtime=ios
      input_digest=58de6c3bbd8d94a89e0c08d038eaa8208191085d74e2ff542107a86cf1098e46 ;;
    macos)
      version=27.0 system=MacOSX triple=arm64-apple-macosx runtime=osx
      input_digest=6c092aaebe8e7c3232a42fa0631ab37daca8a97ad5f57f42755686cda64daa97 ;;
  esac
  if [[ "$phase" == prepare ]]; then
    mkdir -p "$root"
    work=$(mktemp -d "$root/install.XXXXXX")
    download() {
      local url=$1 destination=$2 digest=${3:-}
      curl --fail --silent --show-error --location --retry 3 --connect-timeout 15 "$url" -o "$destination"
      if [[ -n "$digest" ]]; then printf '%s  %s\n' "$digest" "$destination" | sha256sum -c -; fi
    }
    jobs=()
    # Reap background work before deleting its staging directory, including on failure.
    trap 'for job in "${jobs[@]}"; do wait "$job" || :; done; rm -rf -- "$work"' EXIT
    swift_ready="$root/toolchain-v2-beta2-swift-6.4.3.ready"
    sdk_ready="$root/$platform-$version.ready"
    swift_url="https://download.swift.org/swift-6.4.3-release/ubuntu${VERSION_ID//./}/swift-6.4.3-RELEASE/swift-6.4.3-RELEASE-ubuntu$VERSION_ID.tar.gz"
    valid_swift() {
      local toolchain resource
      toolchain=$(realpath "$1") || return 1
      [[ -x "$toolchain/usr/bin/swift" && -x "$toolchain/usr/bin/swiftc" ]] || return 1
      [[ $("$toolchain/usr/bin/swiftc" --version | head -n 1) == 'Swift version 6.4.3 '* ]] || return 1
      resource=$("$toolchain/usr/bin/swiftc" -print-target-info | jq -er '.paths.runtimeResourcePath') || return 1
      [[ "$resource" == "$toolchain/"* && -d "$resource/clang/include" && -r "$resource/linux/libswiftCore.so" ]]
    }
    if [[ -f "$swift_ready" ]] && ! valid_swift "$root/swift"; then rm -f "$swift_ready"; fi
    if [[ ! -f "$swift_ready" ]]; then
      (
        if valid_swift /usr/share/swift; then
          ln -s /usr/share/swift "$work/swift"
          echo 'Using runner Swift 6.4.3 toolchain'
        else
          download "$swift_url" "$work/swift.tar.gz"
          download "$swift_url.sig" "$work/swift.tar.gz.sig"
          mkdir -m 700 "$work/swift-gpg"
          gpg --batch --homedir "$work/swift-gpg" --import "$ci_dir/swift-6-release.asc"
          gpg --batch --homedir "$work/swift-gpg" --status-fd 1 --verify "$work/swift.tar.gz.sig" "$work/swift.tar.gz" |
            awk -v key=52BB7E3DE28A71BE22EC05FFEF80A866B47A981F '$2 == "VALIDSIG" && ($3 == key || $NF == key) { valid = 1 } END { exit !valid }'
          mkdir "$work/swift"
          tar --no-same-owner -xzf "$work/swift.tar.gz" --strip-components=1 -C "$work/swift"
          rm "$work/swift.tar.gz"
        fi
      ) & jobs+=("$!")
      download https://github.com/xtool-org/xtool/releases/download/2.0.0-beta.2/xtool-x86_64.AppImage "$work/xtool.AppImage" \
        512fce299d48b0c59e7bd32787a07ecd018d61a529ed17757b9019d709a667fd & jobs+=("$!")
      download https://github.com/indygreg/apple-platform-rs/releases/download/apple-codesign/0.29.0/apple-codesign-0.29.0-x86_64-unknown-linux-musl.tar.gz "$work/rcodesign.tgz" \
        dbe85cedd8ee4217b64e9a0e4c2aef92ab8bcaaa41f20bde99781ff02e600002 & jobs+=("$!")
    fi
    install_sdk=false
    if [[ ! -f "$sdk_ready" || $(cat "$sdk_ready") != "$input_digest" ]]; then
      install_sdk=true
      sdk_name=${system,,}
      tag="$platform-$version-xcode-27.1-27A9275-r1"
      (
        download "https://github.com/kemono-games/apple-inputs/releases/download/$tag/apple-inputs.tar.gz" "$work/input.tgz" "$input_digest"
        tar --no-same-owner -xzf "$work/input.tgz" -C "$work" "$sdk_name" darwin
        rm "$work/input.tgz"
      ) & jobs+=("$!")
      download https://github.com/xtool-org/darwin-tools-linux-llvm/releases/download/v1.1.0/toolset-x86_64.tar.gz "$work/tools.tgz" \
        a5166f2d56ac45707e5ef2f3c20a41a94af8ef0c0456354224dd08656e874188 & jobs+=("$!")
      download https://github.com/xtool-org/OpenAppleMacros/releases/download/v1.4.1/OpenAppleMacrosServer-x86_64.tar.gz "$work/macros.tgz" \
        2d80c922d0873dd8b0a85e19d10bd7f42a1aea3db3a85f7b6edf56fe9b687a21 & jobs+=("$!")
    fi

    system_command=()
    if [[ $(id -u) != 0 ]]; then system_command=(sudo); fi
    apt() {
      "${system_command[@]}" env NEEDRESTART_MODE=l DEBIAN_FRONTEND=noninteractive apt-get -o Acquire::Retries=3 "$@"
    }
    if [[ ! -x /usr/lib/llvm-23/bin/llvm-lipo ]]; then
      download https://apt.llvm.org/llvm-snapshot.gpg.key "$work/llvm.asc" 8b2a587ffd672c4687e7581dad4b2f6c1bb2ad6b480cd9771ba2ff48e0b8c75d
      gpg --batch --dearmor -o "$work/llvm.gpg" "$work/llvm.asc"
      "${system_command[@]}" install -m 644 "$work/llvm.gpg" /usr/share/keyrings/exact-llvm.gpg
      printf 'deb [signed-by=/usr/share/keyrings/exact-llvm.gpg] https://apt.llvm.org/%s/ llvm-toolchain-%s-23 main\n' "$VERSION_CODENAME" "$VERSION_CODENAME" |
        "${system_command[@]}" tee /etc/apt/sources.list.d/exact-llvm.list >/dev/null
    fi
    xml=libxml2
    if [[ "$VERSION_ID" == 26.04 ]]; then xml=libxml2-16; fi
    packages=(clang-23 lld-23 llvm-23 libcurl4t64 "$xml" libsqlite3-0 libncurses6 libedit2 libzstd1 libssl-dev zip unzip)
    missing=()
    for package in "${packages[@]}"; do
      if [[ $(dpkg-query -W -f='${Status}' "$package" 2>/dev/null) != 'install ok installed' ]]; then
        missing+=("$package")
      fi
    done
    if (( ${#missing[@]} )); then
      apt update -q
      apt install -y -qq --no-install-recommends "${missing[@]}"
    fi
    test -x /usr/lib/llvm-23/bin/llvm-lipo

    for job in "${jobs[@]}"; do wait "$job"; done
    jobs=()

    if [[ ! -f "$swift_ready" ]]; then
      mkdir "$work/bin" "$work/codesign"
      install -m 755 "$work/xtool.AppImage" "$work/bin/xtool"
      tar --no-same-owner -xzf "$work/rcodesign.tgz" --strip-components=1 -C "$work/codesign"
      install -m 755 "$(find "$work/codesign" -name rcodesign -type f -print -quit)" "$work/bin/rcodesign"
      ln -s /usr/lib/llvm-23/bin/llvm-lipo "$work/bin/lipo"
      cat > "$work/bin/xcrun" <<'XCRUN'
#!/usr/bin/env bash
exec bun "${EXACT:?}/host/apple/toolchain.mjs" "$@"
XCRUN
      chmod 755 "$work/bin/xcrun"
      valid_swift "$work/swift"
      "$work/swift/usr/bin/swiftc" --version
      APPIMAGE_EXTRACT_AND_RUN=1 "$work/bin/xtool" --version
      rm -rf -- "$root/swift" "$root/bin"
      mv "$work/swift" "$work/bin" "$root/"
      touch "$swift_ready"
    fi

    # The SDK may have survived a toolchain upgrade in a persistent Boat root.
    resource_path=$("$root/swift/usr/bin/swiftc" -print-target-info | jq -er '.paths.runtimeResourcePath')
    if [[ -d "$root/$platform/swift/clang" ]]; then
      ln -sfn "$resource_path/clang/include" "$root/$platform/swift/clang/include"
    fi

    if "$install_sdk"; then
      sdk="$work/sdk"
      developer="$sdk/Developer/Platforms/$system.platform/Developer"
      device="$developer/SDKs/$system$version.sdk"
      resources="$sdk/swift"
      tools="$sdk/toolset"
      mkdir -p "$developer/SDKs" "$developer/usr/bin" "$developer/usr/lib/swift/host" \
        "$resources/clang/lib" "$tools" "$work/macros"
      mv "$work/$sdk_name" "$device"
      mv "$work/darwin" "$resources/clang/lib/darwin"
      ln -s "../${device#"$sdk/"}"/usr/lib/swift "$resources/$sdk_name"
      resource_path=$("$root/swift/usr/bin/swiftc" -print-target-info | jq -er '.paths.runtimeResourcePath')
      ln -s "$resource_path/clang/include" "$resources/clang/include"

      tar --no-same-owner -xzf "$work/tools.tgz" -C "$tools"
      mv "$tools/bin/libtool" "$tools/bin/llvm-lib"
      tar --no-same-owner -xzf "$work/macros.tgz" -C "$work/macros"
      mv "$work/macros/OpenAppleMacrosServer" "$tools/bin/"
      mkdir "$tools/plugins"
      jq -er '.plugins[]' "$work/macros/info.json" | while read -r library; do
        [[ "$library" =~ ^[A-Za-z_][A-Za-z_0-9]*$ ]]
        touch "$tools/plugins/lib$library.so"
      done
      ln -s "$(realpath --relative-to="$developer/usr/bin" "$tools/bin/OpenAppleMacrosServer")" "$developer/usr/bin/swift-plugin-server"
      ln -s "$(realpath --relative-to="$developer/usr/lib/swift/host" "$tools/plugins")" "$developer/usr/lib/swift/host/plugins"

      jq -n --arg path "${device#"$sdk/"}" --arg triple "$triple" '{
        schemaVersion:"4.0",
        targetTriples:{($triple):{sdkRootPath:$path, swiftResourcesPath:"swift", toolsetPaths:["toolset.json"]}}
      }' > "$sdk/swift-sdk.json"
      jq -n '{
        schemaVersion:"1.0", rootPath:"toolset/bin", linker:{path:"ld64.lld"}, librarian:{path:"llvm-lib"},
        swiftCompiler:{extraCLIOptions:["-Xfrontend","-enable-cross-import-overlays","-use-ld=lld"]}
      }' > "$sdk/toolset.json"
      jq -e --arg version "$version" '.Version == $version' "$device/SDKSettings.json" >/dev/null
      test -r "$device/usr/lib/swift/shims/module.modulemap"
      test -r "$resources/clang/lib/darwin/libclang_rt.$runtime.a"
      test -x "$developer/usr/bin/swift-plugin-server"
      test -d "$developer/usr/lib/swift/host/plugins"
      rm -f -- "$sdk_ready"
      rm -rf -- "$root/$platform"
      mv "$sdk" "$root/$platform"
      printf '%s\n' "$input_digest" > "$sdk_ready"
    fi
    python3 "$ci_dir/apple-linux-compat.py" "$EXACT" "$platform"
  fi
  test -r "$root/$platform/swift-sdk.json"
)

apple_verify_bundle() {
  local bundle=$1 platform=$2 out=$3 binary
  binary=$(python3 - "$bundle" "$platform" "$(jq -er '.app.id' app.json)" <<'PY'
from pathlib import Path
import plistlib
import sys

bundle, platform, expected_id = sys.argv[1:]
root = Path(bundle) / "Contents" if platform == "macos" else Path(bundle)
with (root / "Info.plist").open("rb") as file:
    plist = plistlib.load(file)
name = plist["CFBundleExecutable"]
if plist["CFBundleIdentifier"] != expected_id or not name or Path(name).name != name or name in (".", ".."):
    raise SystemExit(f"Unexpected bundle identity or executable in {root}")
print(root / "MacOS" / name if platform == "macos" else root / name)
PY
)
  llvm-lipo "$binary" -verify_arch arm64
  llvm-objdump --macho --private-headers "$binary" > "$out/platform.txt"
  if [[ "$platform" == macos ]]; then
    grep -Eiq '^[[:space:]]*platform[[:space:]]+(macos|1)[[:space:]]*$' "$out/platform.txt"
    rcodesign print-signature-info --config-file /dev/null "$binary" > "$out/signature.txt"
    grep -q 'CodeSignatureFlags(.*ADHOC' "$out/signature.txt"
    grep -Eq '^[[:space:]]*cms: null[[:space:]]*$' "$out/signature.txt"
  else
    grep -Eiq '^[[:space:]]*platform[[:space:]]+(ios|2)[[:space:]]*$' "$out/platform.txt"
  fi
}
