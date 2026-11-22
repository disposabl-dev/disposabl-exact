#!/usr/bin/env bash
set -euo pipefail
# Public, redistributable toolchain only. Apple SDKs are loaded separately and never cached.
work=$(mktemp -d "$RUNNER_TEMP/exact-cross-tools.XXXXXX")
trap 'rm -rf "$work"' EXIT
sudo apt-get update
sudo apt-get install -y curl ca-certificates gnupg libxml2-dev libsqlite3-0 libcurl4 libncurses6 libz3-4 libicu74 libedit2 zip zstd
curl -fsSL https://apt.llvm.org/llvm-snapshot.gpg.key -o "$work/llvm.key"
printf '%s  %s\n' 8b2a587ffd672c4687e7581dad4b2f6c1bb2ad6b480cd9771ba2ff48e0b8c75d "$work/llvm.key" | sha256sum -c -
gpg --dearmor < "$work/llvm.key" | sudo tee /usr/share/keyrings/exact-llvm.gpg > /dev/null
echo 'deb [signed-by=/usr/share/keyrings/exact-llvm.gpg] https://apt.llvm.org/noble/ llvm-toolchain-noble-23 main' | sudo tee /etc/apt/sources.list.d/exact-llvm.list > /dev/null
sudo apt-get update
sudo apt-get install -y llvm-23 clang-23 lld-23
swift_name=swift-6.4.2-RELEASE-ubuntu24.04
curl -fsSL --retry 3 "https://download.swift.org/swift-6.4.2-release/ubuntu2404/swift-6.4.2-RELEASE/$swift_name.tar.gz" -o "$work/swift.tar.gz"
mkdir -p "$RUNNER_TEMP/exact-cross/swift" "$RUNNER_TEMP/exact-cross/bin"
tar -xzf "$work/swift.tar.gz" --strip-components=1 -C "$RUNNER_TEMP/exact-cross/swift"
codesign=apple-codesign-0.29.0-x86_64-unknown-linux-musl.tar.gz
curl -fsSL --retry 3 "https://github.com/indygreg/apple-platform-rs/releases/download/apple-codesign/0.29.0/$codesign" -o "$work/$codesign"
printf '%s  %s\n' dbe85cedd8ee4217b64e9a0e4c2aef92ab8bcaaa41f20bde99781ff02e600002 "$work/$codesign" | sha256sum -c -
tar -xzf "$work/$codesign" -C "$work"
rcodesign=$(find "$work" -type f -name rcodesign -print -quit)
[[ -n "$rcodesign" ]] || { echo 'rcodesign missing' >&2; exit 1; }
install -m 755 "$rcodesign" "$RUNNER_TEMP/exact-cross/bin/rcodesign"
printf '%s\n' "$RUNNER_TEMP/exact-cross/swift/usr/bin" "$RUNNER_TEMP/exact-cross/bin" /usr/lib/llvm-23/bin >> "$GITHUB_PATH"
echo 'EXACT_APPLE_LLVM_BIN=/usr/lib/llvm-23/bin' >> "$GITHUB_ENV"
