#!/usr/bin/env bash
# Boat x86_64 Ubuntu 24.04 installer, suitable for boat new --setup-file.
# Stage ~/darwin.xtoolsdk.tar.gz (or set EXACT_APPLE_SDK_ARCHIVE).
# An HTTPS source can be set with EXACT_APPLE_SDK_URL and EXACT_APPLE_SDK_SHA256.
# EXACT_APPLE_SDK_WAIT_SECONDS allows the archive to arrive after Boat starts.
set -Eeuo pipefail

fail() { printf 'Exact setup: %s\n' "$*" >&2; exit 1; }
step() { printf '\n== %s ==\n' "$*"; }
download() { curl --fail --silent --show-error --location --retry 3 --proto '=https' "$1" -o "$2"; }

. /etc/os-release
[[ $ID == ubuntu && $VERSION_ID == 24.04 && $(uname -m) == x86_64 ]] ||
  fail 'this installer needs x86_64 Ubuntu 24.04'

tools_dir="$HOME/.local/share/disposabl-exact"
config_dir="$HOME/.config/disposabl-exact"
exact_dir="$HOME/exact"
export ANDROID_HOME="$HOME/Android/Sdk"
android_tools="$ANDROID_HOME/cmdline-tools/latest/bin"
llvm_major=23
export EXACT_APPLE_LLVM_BIN="/usr/lib/llvm-$llvm_major/bin"

mkdir -p "$tools_dir" "$config_dir" "$ANDROID_HOME" "$HOME/.local/bin"
exec 9>"$config_dir/install.lock"
flock -n 9 || fail 'another installation is already running'
exec > >(tee "$config_dir/install.log") 2>&1
staging=$(mktemp -d)
trap 'rm -rf -- "$staging"' EXIT
trap 'printf "Exact setup failed on line %s\n" "$LINENO" >&2' ERR

step 'Ubuntu build tools and LLVM'
download https://apt.llvm.org/llvm-snapshot.gpg.key "$staging/llvm.asc"
gpg --batch --dearmor -o "$staging/llvm.gpg" "$staging/llvm.asc"
sudo install -m 0644 "$staging/llvm.gpg" /usr/share/keyrings/disposabl-exact-llvm.gpg
printf 'deb [signed-by=/usr/share/keyrings/disposabl-exact-llvm.gpg] https://apt.llvm.org/noble/ llvm-toolchain-noble-%s main\n' \
  "$llvm_major" | sudo tee /etc/apt/sources.list.d/disposabl-exact-llvm.list >/dev/null
sudo apt-get update --allow-releaseinfo-change-label
jdk_package=$(apt-cache pkgnames openjdk- |
  awk '/^openjdk-[0-9]+-jdk-headless$/ && $0 !~ /^openjdk-1[0-6]-/' |
  sort -V | tail -1)
[[ -n $jdk_package ]] || fail 'Ubuntu offers no suitable JDK'
sudo env DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
  "$jdk_package" "clang-$llvm_major" "lld-$llvm_major" "llvm-$llvm_major" \
  build-essential pkg-config libssl-dev libicu-dev libxml2-dev libcurl4-openssl-dev \
  libsqlite3-dev zlib1g-dev libedit2 libncurses6 libpython3.12 \
  curl ca-certificates git jq python3 unzip zip xz-utils ffmpeg
jdk_major=${jdk_package#openjdk-}
export JAVA_HOME="/usr/lib/jvm/java-${jdk_major%%-*}-openjdk-amd64"
test -x "$JAVA_HOME/bin/javac"

step 'Latest Bun and the Exact checkout'
download https://api.github.com/repos/oven-sh/bun/releases/latest "$staging/bun.json"
read -r bun_url bun_digest < <(jq -er '.assets[] | select(.name == "bun-linux-x64-baseline.zip") | [.browser_download_url, .digest] | @tsv' "$staging/bun.json")
download "$bun_url" "$staging/bun.zip"
printf '%s  %s\n' "${bun_digest#sha256:}" "$staging/bun.zip" | sha256sum --check
unzip -q "$staging/bun.zip" -d "$staging"
install -D -m 0755 "$staging/bun-linux-x64-baseline/bun" "$tools_dir/bin/bun"
export PATH="$tools_dir/bin:$HOME/.bun/bin:$HOME/.cargo/bin:$HOME/.local/bin:$JAVA_HOME/bin:$android_tools:$ANDROID_HOME/platform-tools:$ANDROID_HOME/emulator:$EXACT_APPLE_LLVM_BIN:$PATH"

if [[ ! -e $exact_dir ]]; then
  git init -q "$exact_dir"
  git -C "$exact_dir" remote add origin https://github.com/expo/exact.git
fi
[[ $(git -C "$exact_dir" remote get-url origin) == https://github.com/expo/exact.git ]] ||
  fail "$exact_dir has an unexpected Git remote"
git -C "$exact_dir" fetch --depth 1 origin "${EXACT_REF:-refs/heads/main}"
git -C "$exact_dir" checkout --detach FETCH_HEAD
cd "$exact_dir"
printf 'Exact revision %s\n' "$(git rev-parse HEAD)"

# Boat installs Rustup centrally. Cargo still puts its binaries in ~/.cargo/bin.
rustup set auto-self-update disable
rustup update stable --no-self-update

step 'Android SDK, NDK, and emulator image'
if [[ ! -x $android_tools/sdkmanager ]]; then
  download https://dl.google.com/android/repository/repository2-3.xml "$staging/android.xml"
  read -r android_zip android_digest < <(python3 - "$staging/android.xml" <<'PY'
import sys
import xml.etree.ElementTree as ET

root = ET.parse(sys.argv[1])
package = root.find("./remotePackage[@path='cmdline-tools;latest']")
for archive in package.findall("./archives/archive"):
    if archive.findtext("host-os") == "linux":
        print(archive.findtext("complete/url"), archive.findtext("complete/checksum"))
        break
else:
    sys.exit("Android command-line tools for Linux were not found")
PY
)
  download "https://dl.google.com/android/repository/$android_zip" "$staging/android.zip"
  printf '%s  %s\n' "$android_digest" "$staging/android.zip" | sha1sum --check
  unzip -q "$staging/android.zip" -d "$staging"
  mkdir -p "$ANDROID_HOME/cmdline-tools"
  mv "$staging/cmdline-tools" "$ANDROID_HOME/cmdline-tools/latest"
fi

# sdkmanager can close stdin before yes stops. Only its exit status matters.
(set +o pipefail; yes | sdkmanager --licenses >/dev/null)
sdkmanager --list --channel=0 > "$staging/android-packages"
latest_android_package() {
  # Google changed sdkmanager output from a pipe table to the Android CLI list.
  awk -v pattern="$1" '
    {
      gsub(/\|/, " ")
      package = $1
      gsub(/\//, ";", package)
      if (package ~ pattern && $2 ~ /^[0-9]+([.][0-9]+)*$/) print package
    }
  ' "$staging/android-packages" | sort -Vu | tail -1
}
platform=$(latest_android_package '^platforms;android-[0-9]+([.][0-9]+)*$')
build_tools=$(latest_android_package '^build-tools;[0-9]+([.][0-9]+)*$')
ndk=$(latest_android_package '^ndk;[0-9]+([.][0-9]+)*$')
image=$(latest_android_package '^system-images;android-[0-9]+([.][0-9]+)*;google_apis;x86_64$')
[[ -n $platform && -n $build_tools && -n $ndk && -n $image ]] ||
  fail 'could not resolve stable Android SDK packages'
# Keep the SDK and Build Tools versions that Exact's Gradle project requires.
required_packages=$(bun -e 'import {androidSdkPackages} from "./scripts/agent-android.mjs"; for (const pkg of androidSdkPackages()) console.log(pkg.id)')
mapfile -t exact_android_packages <<< "$required_packages"
mapfile -t android_packages < <(printf '%s\n' \
  "$platform" "$build_tools" "$ndk" "$image" "${exact_android_packages[@]}" platform-tools emulator | sort -u)
sdkmanager --install "${android_packages[@]}"
if ! emulator -list-avds | grep -Fxq exact_android; then
  printf 'no\n' | avdmanager create avd --name exact_android --package "$image" --device pixel_6
fi
emulator -accel-check

step 'Swift, xtool, and Apple signing tools'
download https://www.swift.org/api/v1/install/releases.json "$staging/swift.json"
swift_version=$(jq -er '.[] | select(any(.platforms[]?; .name == "Ubuntu 24.04" and (.archs | index("x86_64")))) | .name | select(test("^[0-9]+[.][0-9]+[.][0-9]+$"))' "$staging/swift.json" | sort -V | tail -1)
[[ -n $swift_version ]] || fail 'could not resolve the latest stable Swift release'
swift_release="swift-$swift_version-RELEASE"
swift_tar="$swift_release-ubuntu24.04.tar.gz"
swift_url="https://download.swift.org/swift-$swift_version-release/ubuntu2404/$swift_release/$swift_tar"
swift_dir="$tools_dir/$swift_release-ubuntu24.04"
if [[ ! -x $swift_dir/usr/bin/swift ]]; then
  download https://www.swift.org/keys/all-keys.asc "$staging/swift-keys.asc"
  download "$swift_url" "$staging/$swift_tar"
  download "$swift_url.sig" "$staging/$swift_tar.sig"
  install -d -m 0700 "$staging/gnupg"
  gpg --batch --homedir "$staging/gnupg" --import "$staging/swift-keys.asc"
  gpg --batch --homedir "$staging/gnupg" --verify "$staging/$swift_tar.sig" "$staging/$swift_tar"
  tar -xzf "$staging/$swift_tar" -C "$tools_dir"
fi
export PATH="$swift_dir/usr/bin:$PATH"

download https://api.github.com/repos/xtool-org/xtool/releases/latest "$staging/xtool.json"
read -r xtool_url xtool_digest < <(jq -er '.assets[] | select(.name == "xtool-x86_64.AppImage") | [.browser_download_url, .digest] | @tsv' "$staging/xtool.json")
download "$xtool_url" "$staging/xtool"
printf '%s  %s\n' "${xtool_digest#sha256:}" "$staging/xtool" | sha256sum --check
install -m 0755 "$staging/xtool" "$HOME/.local/bin/xtool"

download https://api.github.com/repos/indygreg/apple-platform-rs/releases/latest "$staging/rcodesign.json"
rcodesign_url=$(jq -er '.assets[] | select(.name | endswith("-x86_64-unknown-linux-musl.tar.gz")) | .browser_download_url' "$staging/rcodesign.json")
download "$rcodesign_url" "$staging/rcodesign.tar.gz"
download "$rcodesign_url.sha256" "$staging/rcodesign.sha256"
rcodesign_digest=$(awk 'NR == 1 {print $1}' "$staging/rcodesign.sha256")
printf '%s  %s\n' "$rcodesign_digest" "$staging/rcodesign.tar.gz" | sha256sum --check
mkdir "$staging/rcodesign"
tar -xzf "$staging/rcodesign.tar.gz" --strip-components=1 -C "$staging/rcodesign"
install -m 0755 "$staging/rcodesign/rcodesign" "$HOME/.local/bin/rcodesign"

step 'Install the Apple SDK'
apple_sdk="$HOME/.swiftpm/swift-sdks/darwin.artifactbundle/swift-sdk.json"
if [[ ! -f $apple_sdk ]]; then
  sdk_archive=${EXACT_APPLE_SDK_ARCHIVE:-"$HOME/darwin.xtoolsdk.tar.gz"}
  if [[ -n ${EXACT_APPLE_SDK_URL:-} ]]; then
    [[ ${EXACT_APPLE_SDK_SHA256:-} =~ ^[0-9a-fA-F]{64}$ ]] ||
      fail 'EXACT_APPLE_SDK_URL requires EXACT_APPLE_SDK_SHA256'
    sdk_archive="$staging/darwin.xtoolsdk.tar.gz"
    download "$EXACT_APPLE_SDK_URL" "$sdk_archive"
    printf '%s  %s\n' "$EXACT_APPLE_SDK_SHA256" "$sdk_archive" | sha256sum --check
  fi
  wait_seconds=${EXACT_APPLE_SDK_WAIT_SECONDS:-0}
  [[ $wait_seconds =~ ^[0-9]+$ ]] || fail 'EXACT_APPLE_SDK_WAIT_SECONDS must be a count in seconds'
  if [[ ! -e $sdk_archive && $wait_seconds != 0 ]]; then
    printf 'Waiting up to %s seconds for the staged Apple SDK.\n' "$wait_seconds"
    timeout "$wait_seconds" bash -c 'until [[ -e $1 ]]; do sleep 5; done' _ "$sdk_archive" ||
      fail 'the Apple SDK archive did not arrive before the timeout'
  fi
  [[ -e $sdk_archive ]] || fail 'stage the Apple SDK archive or set EXACT_APPLE_SDK_URL and EXACT_APPLE_SDK_SHA256'
  case "$sdk_archive" in
    *.xtoolsdk.tar.gz)
      tar -xzf "$sdk_archive" -C "$staging"
      sdk_archive="$staging/darwin.xtoolsdk"
      ;;
    *.xtoolsdk|*.xip) ;;
    *) fail 'the Apple SDK must be a .xtoolsdk directory, darwin.xtoolsdk.tar.gz, or .xip' ;;
  esac
  APPIMAGE_EXTRACT_AND_RUN=1 xtool sdk install --slim "$sdk_archive"
fi
test -f "$apple_sdk"

step 'Exact dependencies and platform checks'
bun scripts/exact.mjs setup
rust_pin=$(bun -e 'console.log(Bun.TOML.parse(await Bun.file("rust-toolchain.toml").text()).toolchain.channel)')
# The default Exact setup covers Android ARM64. The Boat emulator is x86_64.
rustup target add x86_64-linux-android --toolchain "$rust_pin"
cargo run --locked --manifest-path vendor/ibex/crates/hermes-lean-sys-installer/Cargo.toml -- --target x86_64-linux-android
bun link
for platform in web android ios; do
  bun scripts/exact.mjs setup --check --platform "$platform"
done
bun scripts/exact.mjs setup --check --platform ios --device

step 'Persist the build environment'
cat > "$config_dir/env.sh" <<EOF
export ANDROID_HOME="$ANDROID_HOME"
export JAVA_HOME="$JAVA_HOME"
export EXACT_APPLE_LLVM_BIN="$EXACT_APPLE_LLVM_BIN"
export PATH="$swift_dir/usr/bin:$tools_dir/bin:$HOME/.bun/bin:$HOME/.cargo/bin:$HOME/.local/bin:$JAVA_HOME/bin:$android_tools:$ANDROID_HOME/platform-tools:$ANDROID_HOME/emulator:$EXACT_APPLE_LLVM_BIN:\$PATH"
EOF
for startup in "$HOME/.profile" "$HOME/.bashrc"; do
  source_line='. "$HOME/.config/disposabl-exact/env.sh"'
  if ! grep -Fxq "$source_line" "$startup" 2>/dev/null; then
    printf '\n%s\n' "$source_line" >> "$startup"
  fi
done
printf '\nExact is linked in ~/.bun/bin. Android AVD exact_android is registered.\n'
