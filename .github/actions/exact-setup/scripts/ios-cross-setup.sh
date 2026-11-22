#!/usr/bin/env bash
set -euo pipefail

work=$(mktemp -d "$RUNNER_TEMP/exact-ios-download.XXXXXX")
trap 'rm -rf "$work"' EXIT
install_dir=$(mktemp -d "$RUNNER_TEMP/exact-ios.XXXXXX")
mkdir "$install_dir/swift" "$install_dir/bin"

download_verified() {
  local url=$1 sha=$2 file=$3
  curl -fsSL --retry 3 "$url" -o "$file"
  printf '%s  %s\n' "$sha" "$file" | sha256sum -c -
}

download_verified https://apt.llvm.org/llvm-snapshot.gpg.key \
  8b2a587ffd672c4687e7581dad4b2f6c1bb2ad6b480cd9771ba2ff48e0b8c75d "$work/llvm.key"
gpg --batch --dearmor < "$work/llvm.key" | sudo tee /usr/share/keyrings/exact-llvm.gpg > /dev/null
echo 'deb [signed-by=/usr/share/keyrings/exact-llvm.gpg] https://apt.llvm.org/noble/ llvm-toolchain-noble-23 main' |
  sudo tee /etc/apt/sources.list.d/exact-llvm.list > /dev/null
sudo apt-get update
sudo apt-get install -y clang-23 lld-23 llvm-23 libcurl4-openssl-dev libedit2 \
  libgcc-13-dev libncurses-dev libpython3-dev libsqlite3-0 libstdc++-13-dev \
  libxml2-dev libz3-dev unzip zip zlib1g-dev

swift_url=https://download.swift.org/swift-6.4.2-release/ubuntu2404/swift-6.4.2-RELEASE/swift-6.4.2-RELEASE-ubuntu24.04.tar.gz
curl -fsSL --retry 3 "$swift_url" -o "$work/swift.tar.gz"
curl -fsSL --retry 3 "$swift_url.sig" -o "$work/swift.tar.gz.sig"
mkdir -m 700 "$work/gpg"
curl -fsSL --retry 3 https://swift.org/keys/all-keys.asc |
  gpg --homedir "$work/gpg" --batch --import
gpg --homedir "$work/gpg" --batch --verify "$work/swift.tar.gz.sig" "$work/swift.tar.gz"
tar -xzf "$work/swift.tar.gz" --strip-components=1 -C "$install_dir/swift"
rm "$work/swift.tar.gz"

codesign=apple-codesign-0.29.0-x86_64-unknown-linux-musl.tar.gz
download_verified "https://github.com/indygreg/apple-platform-rs/releases/download/apple-codesign/0.29.0/$codesign" \
  dbe85cedd8ee4217b64e9a0e4c2aef92ab8bcaaa41f20bde99781ff02e600002 "$work/$codesign"
tar -xzf "$work/$codesign" -C "$work"
rcodesign=$(find "$work" -type f -name rcodesign -print -quit)
install -m 755 "${rcodesign:?missing rcodesign binary}" "$install_dir/bin/rcodesign"

# Assemble the device paths that Exact reads from an installed Darwin Swift SDK.
sdk="$install_dir/darwin.artifactbundle"
platform="$sdk/Developer/Platforms/iPhoneOS.platform/Developer"
resources="$sdk/swift"
device_sdk="$platform/SDKs/iPhoneOS27.1.sdk"
mkdir -p "$platform/SDKs" "$platform/usr/bin" "$platform/usr/lib/swift/host" \
  "$resources/clang/lib" "$sdk/toolset" "$sdk/macros" "$work/apple"
download_verified "https://github.com/kemono-games/apple-inputs/releases/download/ios-27.1-xcode-27.1-27A9275-r1/apple-inputs.tar.gz" \
  58de6c3bbd8d94a89e0c08d038eaa8208191085d74e2ff542107a86cf1098e46 "$work/apple.tar.gz"
tar -xzf "$work/apple.tar.gz" -C "$work/apple" iphoneos darwin
mv "$work/apple/iphoneos" "$device_sdk"
mv "$work/apple/darwin" "$resources/clang/lib/darwin"
ln -s "$device_sdk/usr/lib/swift" "$resources/iphoneos"
ln -s "$device_sdk/usr/lib/swift/shims" "$resources/shims"
swift_resource=$("$install_dir/swift/usr/bin/swiftc" -print-target-info | jq -er '.paths.runtimeResourcePath')
ln -s "$swift_resource/clang/include" "$resources/clang/include"

download_verified https://github.com/xtool-org/darwin-tools-linux-llvm/releases/download/v1.1.0/toolset-x86_64.tar.gz \
  a5166f2d56ac45707e5ef2f3c20a41a94af8ef0c0456354224dd08656e874188 "$work/toolset.tar.gz"
tar -xzf "$work/toolset.tar.gz" -C "$sdk/toolset"
mv "$sdk/toolset/bin/libtool" "$sdk/toolset/bin/llvm-lib"

download_verified https://github.com/xtool-org/OpenAppleMacros/releases/download/v1.4.1/OpenAppleMacrosServer-x86_64.tar.gz \
  2d80c922d0873dd8b0a85e19d10bd7f42a1aea3db3a85f7b6edf56fe9b687a21 "$work/macros.tar.gz"
tar -xzf "$work/macros.tar.gz" -C "$sdk/macros"
mkdir "$sdk/macros/plugins"
jq -er '.plugins[]' "$sdk/macros/info.json" | while IFS= read -r library; do
  [[ "$library" =~ ^[A-Za-z_][A-Za-z_0-9]*$ ]]
  touch "$sdk/macros/plugins/lib$library.so"
done
ln -s "$sdk/macros/OpenAppleMacrosServer" "$platform/usr/bin/swift-plugin-server"
ln -s "$sdk/macros/plugins" "$platform/usr/lib/swift/host/plugins"

cat > "$sdk/swift-sdk.json" <<'JSON'
{
  "schemaVersion": "4.0",
  "targetTriples": {
    "arm64-apple-ios": {
      "sdkRootPath": "Developer/Platforms/iPhoneOS.platform/Developer/SDKs/iPhoneOS27.1.sdk",
      "swiftResourcesPath": "swift",
      "toolsetPaths": ["toolset.json"]
    }
  }
}
JSON
cat > "$sdk/toolset.json" <<'JSON'
{
  "schemaVersion": "1.0",
  "rootPath": "toolset/bin",
  "linker": { "path": "ld64.lld" },
  "librarian": { "path": "llvm-lib" },
  "swiftCompiler": { "extraCLIOptions": ["-Xfrontend", "-enable-cross-import-overlays", "-use-ld=lld"] }
}
JSON

printf '%s\n' "$install_dir/swift/usr/bin" "$install_dir/bin" /usr/lib/llvm-23/bin >> "$GITHUB_PATH"
printf 'EXACT_APPLE_SDK=%s\nEXACT_APPLE_LLVM_BIN=/usr/lib/llvm-23/bin\n' "$sdk" >> "$GITHUB_ENV"
