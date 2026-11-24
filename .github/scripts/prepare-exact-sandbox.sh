#!/usr/bin/env bash
# Standalone Ubuntu x86-64 setup. This file also installs the device lifecycle command.
set -euo pipefail

die() { printf '%s\n' "$*" >&2; exit 1; }
log() { printf '\n==> %s\n' "$*"; }
if [[ ${1:-} == --help ]]; then
    cat <<'USAGE'
Usage: bash prepare-exact-sandbox.sh
Run as a non-root user with passwordless sudo on Ubuntu x86-64.

EXACT_SANDBOX_PROFILE=all   Prepare CI tools and all three devices (default).
EXACT_SANDBOX_PROFILE=ci    Prepare build tools and caches without emulators.
EXACT_SANDBOX_AUTOSTART=1   Enable the devices on subsequent boots.
EXACT_SANDBOX_XCODE_XIP     Optional path to a local Xcode archive for xtool.

Use ~/.local/bin/exact-sandbox-run for Exact commands in an app checkout.
Use ~/.local/bin/exact-sandbox-devices up on a prepared development machine.
USAGE
    exit
fi
[[ $# == 0 ]] || die 'Unknown arguments. See --help.'
[[ $(uname -sm) == 'Linux x86_64' ]] || die 'An Ubuntu x86-64 VM is required.'
[[ $(id -u) != 0 ]] || die 'Run as the sandbox user with passwordless sudo.'
. /etc/os-release
[[ $ID == ubuntu ]] && dpkg --compare-versions "$VERSION_ID" ge 24.04 || die 'Ubuntu 24.04 or later is required.'
sudo -n true || die 'Passwordless sudo is required for host packages and devices.'

mode=${EXACT_SANDBOX_PROFILE:-all}
case "$mode" in all|ci) ;; *) die 'EXACT_SANDBOX_PROFILE must be all or ci.' ;; esac
if [[ $mode == all && $(ps -p 1 -o comm=) != systemd ]]; then
    die 'The device profile requires an Ubuntu VM booted with systemd.'
fi
if [[ $mode == all && ! -c /dev/kvm ]]; then
    die 'The device profile needs /dev/kvm for Android. Use the CI profile on a VM without KVM.'
fi
root="$HOME/.local/share/exact-sandbox"
bin="$HOME/.local/bin"
mkdir -p "$root"/{downloads,runner/home,android} "$bin"
if [[ ${EXACT_SANDBOX_PREPARING:-0} != 1 ]]; then
    exec flock --close "$root/prepare.lock" env EXACT_SANDBOX_PREPARING=1 bash "$0"
fi
export PATH="$bin:$PATH"
export ANDROID_HOME="$root/android/sdk"
export ANDROID_AVD_HOME="$root/android/avd"
export JAVA_HOME=/usr/lib/jvm/java-21-openjdk-amd64

exact_ref=a55c5581c7e1a62cdee1f09367ea2909c74c7292
bun_version=1.4.5
release="v10-exact-$exact_ref-bun-$bun_version"
release_url="https://github.com/disposabl-dev/disposabl-exact/releases/download/$release"
runner_image="disposabl/exact-sandbox:$release"
android_image='system-images;android-37.0;google_apis;x86_64'
agent_version=v0.1.0
runtime_build=24B8117
duo_runtime_build=24B91016s

fetch() {
    local url=$1 path=$2 hash=$3 tool=${4:-sha256sum}
    if [[ -f "$path" ]] && printf '%s  %s\n' "$hash" "$path" | "$tool" --check --status; then
        return
    fi
    curl --fail --location --silent --show-error --retry 4 "$url" --output "$path.part"
    printf '%s  %s\n' "$hash" "$path.part" | "$tool" --check --status || die "Checksum mismatch for ${url##*/}"
    mv -f "$path.part" "$path"
}

log 'Installing Ubuntu prerequisites'
sudo -n apt-get update -qq
sudo -n env DEBIAN_FRONTEND=noninteractive apt-get install -yqq \
    acl ca-certificates curl dbus-user-session git jq openjdk-21-jdk-headless \
    python3 python3-pil unzip zstd libgl1 libpulse0 libnss3 libxkbcommon0 libx11-6 libxcb1
if ! command -v docker >/dev/null; then
    sudo -n env DEBIAN_FRONTEND=noninteractive apt-get install -yqq docker.io
fi
if ! docker info >/dev/null 2>&1; then
    if ! sudo -n docker info >/dev/null 2>&1; then
        [[ $(ps -p 1 -o comm=) == systemd ]] ||
            die 'The CI profile needs a running Docker daemon on this host.'
        sudo -n systemctl start docker
        sudo -n docker info >/dev/null
    fi
fi
if [[ $mode == all ]]; then sudo -n loginctl enable-linger "$(id -un)"; fi
cat > "$root/settings" <<SETTINGS
ANDROID_HOME=$ANDROID_HOME
ANDROID_AVD_HOME=$ANDROID_AVD_HOME
ANDROID_AVD=exact_api37
SETTINGS

prepare_ios() {
    local agent_home="$HOME/.local/share/agent-sim" runtime="$HOME/.local/share/x86sim"
    local device name build source_cache cache
    if [[ ! -x "$agent_home/src/bin/agent-sim" ]]; then
        log 'Installing agent-sim'
        fetch "https://github.com/Developing-Gamer/agent-sim/releases/download/$agent_version/agent-sim-x86_64-linux.tar.gz" \
            "$root/downloads/agent-sim.tar.gz" 7417da971cc120250caca7ca611fe7540e923bb0a3a0ce595b99d01e5a7f7359
        mkdir -p "$agent_home/src"
        tar -xzf "$root/downloads/agent-sim.tar.gz" --strip-components=1 -C "$agent_home/src"
    fi
    ln -sfn "$agent_home/src/bin/agent-sim" "$bin/agent-sim"
    for device in pool1 pool2; do
        case "$device" in
            pool1) name='iPhone 18 Pro'; build=$runtime_build ;;
            pool2) name='iPhone Duo'; build=$duo_runtime_build ;;
        esac
        source_cache="$HOME/.cache/x86sim/jc-$build"
        cache="$root/ios/jc-$build"
        mkdir -p "$(dirname "$source_cache")" "$(dirname "$cache")"
        if [[ -d "$source_cache" && ! -L "$source_cache" && ! -e "$cache" ]]; then
            mv "$source_cache" "$cache"
        fi
        mkdir -p "$cache"
        if [[ ! -e "$source_cache" && ! -L "$source_cache" ]]; then
            ln -s "$cache" "$source_cache"
        fi
        [[ $(readlink -f "$source_cache") == "$cache" ]] || die "The x86Sim cache is already configured at $source_cache"
        if [[ ! -f "$runtime/var/device-a64-$device/.agent-sim-granted" ]]; then
            log "Preparing $name ($device)"
            DEVICE="$device" MODEL="$name" RUNTIME_BUILD="$build" \
                "$agent_home/src/scripts/setup-vm.sh"
        fi
        [[ $(<"$runtime/var/device-a64-$device/runtime") == *-"$build"-arm64 ]] ||
            die "iOS $device was created with a different runtime. Preserve its data and prepare on a fresh VM."
    done
}

prepare_android() {
    local tools_dir="$ANDROID_HOME/cmdline-tools/latest" tmp sdk
    export PATH="$JAVA_HOME/bin:$PATH"
    if [[ ! -x "$tools_dir/bin/sdkmanager" ]]; then
        fetch 'https://dl.google.com/android/repository/commandlinetools-linux-16111833_latest.zip' \
            "$root/downloads/android-tools.zip" e025545c62a8e64c7559119566a569fb1dec5f60 sha1sum
        tmp=$(mktemp -d "$root/android/tools.XXXXXX")
        unzip -q "$root/downloads/android-tools.zip" -d "$tmp"
        mkdir -p "$(dirname "$tools_dir")"
        mv "$tmp/cmdline-tools" "$tools_dir"
        rmdir "$tmp"
    fi
    sdk="$tools_dir/bin/sdkmanager"
    (set +o pipefail; yes | "$sdk" --sdk_root="$ANDROID_HOME" --licenses >/dev/null)
    log 'Installing Android build SDK'
    "$sdk" --sdk_root="$ANDROID_HOME" 'platform-tools' 'platforms;android-37.2' \
        'build-tools;36.0.0' 'build-tools;37.0.0' 'ndk;27.3.13750724'
    if [[ $mode == all ]]; then
        log 'Installing Android emulator'
        "$sdk" --sdk_root="$ANDROID_HOME" 'emulator' "$android_image"
        mkdir -p "$ANDROID_AVD_HOME"
        if [[ ! -f "$ANDROID_AVD_HOME/exact_api37.ini" ]]; then
            printf 'no\n' | "$tools_dir/bin/avdmanager" create avd --name exact_api37 --package "$android_image"
        fi
    fi
}

prepare_xtool() {
    log 'Installing xtool 2 beta'
    fetch 'https://github.com/xtool-org/xtool/releases/download/2.0.0-beta.1/xtool-x86_64.AppImage' \
        "$root/downloads/xtool2.AppImage" 0361a2570e46a7734e8bafa71715ca8a72cf218e0e7a945eef0e4d71733b19e3
    chmod 755 "$root/downloads/xtool2.AppImage"
    cat > "$bin/xtool2" <<'XTOOL'
#!/usr/bin/env bash
set -euo pipefail
export APPIMAGE_EXTRACT_AND_RUN=1
exec "$HOME/.local/share/exact-sandbox/downloads/xtool2.AppImage" "$@"
XTOOL
    chmod 755 "$bin/xtool2"
    "$bin/xtool2" --version
    if [[ -n ${EXACT_SANDBOX_XCODE_XIP:-} ]]; then
        "$bin/xtool2" sdk install --slim "$EXACT_SANDBOX_XCODE_XIP"
    fi
}

prepare_exact() {
    local web_bundle="exact-$exact_ref-web-Linux-X64-bun-$bun_version.tar.zst"
    local android_bundle="exact-$exact_ref-android-Linux-X64-bun-$bun_version.tar.zst"
    local home="$root/runner/home" sdk="$root/runner/home/sdk" manifest="$root/downloads/inputs.json"
    local docker=(docker) file hash rust
    docker info >/dev/null 2>&1 || docker=(sudo -n docker)
    if [[ ! -f "$root/runner/ready-$release" ]]; then
        log "Preparing Exact $release and Rust caches"
        fetch "$release_url/inputs.json" "$manifest" a794d5dcb85b69bbd3014415a35caec93e8fc1dda895dac87c43efeabfc12584
        for file in sdk.tar.zst "$android_bundle" cargo-android.zst cargo-gradle.zst "$web_bundle"; do
            hash=$(jq -er --arg asset "$file" '.[$asset].sha256' "$manifest")
            fetch "$release_url/$file" "$root/downloads/$file" "$hash"
        done
        mkdir -p "$sdk" "$home/.cache/exact-native/cargo" "$home/.gradle"
        tar --zstd -xf "$root/downloads/sdk.tar.zst" -C "$sdk"
        [[ $(git -C "$sdk" rev-parse HEAD) == "$exact_ref" ]] || die 'Exact SDK revision did not match the release pin.'
        git -C "$sdk" restore --source=HEAD --worktree -- .
        tar --zstd -xf "$root/downloads/$android_bundle" -C "$home"
        tar --zstd -xf "$root/downloads/$web_bundle" -C "$home"
        tar --zstd -xf "$root/downloads/cargo-android.zst" -C "$home/.cache/exact-native/cargo"
        tar --zstd -xf "$root/downloads/cargo-gradle.zst" -C "$home/.gradle"
        if ! "${docker[@]}" image inspect "$runner_image" >/dev/null 2>&1; then
            "${docker[@]}" build --tag "$runner_image" - <<'DOCKERFILE'
FROM ubuntu:26.04@sha256:0d5255be560e2d2ddcfbfda88549e9e815ef29e7cd7fc62183d5709e6e2963c6
ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates curl git jq python3 unzip zstd \
    build-essential pkg-config libssl-dev openjdk-21-jdk-headless rustup \
    && curl -fsSL --retry 3 https://github.com/oven-sh/bun/releases/download/bun-v1.4.5/bun-linux-x64.zip -o /tmp/bun.zip \
    && echo "94559b3b528995a49452f9f2404cec74f2efd7d06e0a000a8cd214b02c3666eb  /tmp/bun.zip" | sha256sum -c - \
    && unzip -p /tmp/bun.zip bun-linux-x64/bun > /usr/local/bin/bun && chmod 755 /usr/local/bin/bun \
    && curl -fsSL --retry 3 https://dl.google.com/linux/direct/google-chrome-stable_current_amd64.deb -o /tmp/chrome.deb \
    && apt-get install -y --no-install-recommends /tmp/chrome.deb \
    && rm -rf /tmp/bun.zip /tmp/chrome.deb /var/lib/apt/lists/*
DOCKERFILE
        fi
        "${docker[@]}" save "$runner_image" | zstd -q -f -T2 -1 -o "$root/runner/image.tar.zst.part"
        mv "$root/runner/image.tar.zst.part" "$root/runner/image.tar.zst"
    fi
    cat > "$bin/exact-sandbox-run" <<'RUNNER'
#!/usr/bin/env bash
set -euo pipefail
root="$HOME/.local/share/exact-sandbox"
image=disposabl/exact-sandbox:v10-exact-a55c5581c7e1a62cdee1f09367ea2909c74c7292-bun-1.4.5
ref=a55c5581c7e1a62cdee1f09367ea2909c74c7292
docker=(docker)
docker info >/dev/null 2>&1 || docker=(sudo -n --preserve-env=CONVEX_ORIGIN,CONVEX_SITE_ORIGIN docker)
if ! "${docker[@]}" image inspect "$image" >/dev/null 2>&1; then
    zstd -dc "$root/runner/image.tar.zst" | "${docker[@]}" load >/dev/null
fi
exec "${docker[@]}" run --pull=never --rm --init --network host --user "$(id -u):$(id -g)" \
    --env HOME=/home/exact --env EXACT=/home/exact/sdk --env EXACT_TOOLS_ORIGIN=none \
    --env "EXACT_PUBLISH_TOOLS=/home/exact/.cache/exact/publisher/$ref" --env CHROME=/usr/bin/google-chrome \
    --env RUSTUP_HOME=/home/exact/.rustup --env CARGO_HOME=/home/exact/.cargo \
    --env CARGO_TARGET_DIR=/home/exact/.cache/exact-native/cargo \
    --env "ANDROID_HOME=$root/android/sdk" --env "ANDROID_SDK_ROOT=$root/android/sdk" \
    --env JAVA_HOME=/usr/lib/jvm/java-21-openjdk-amd64 --env CONVEX_ORIGIN --env CONVEX_SITE_ORIGIN \
    --mount "type=bind,source=$root/runner/home,target=/home/exact" \
    --mount "type=bind,source=$root/android,target=$root/android" \
    --mount "type=bind,source=$PWD,target=$PWD" --workdir "$PWD" "$image" "$@"
RUNNER
    chmod 755 "$bin/exact-sandbox-run"
    if [[ ! -f "$root/runner/ready-$release" ]]; then
        rust=$(awk -F'"' '/^channel =/ {print $2; exit}' "$sdk/rust-toolchain.toml")
        "$bin/exact-sandbox-run" rustup toolchain install "$rust" --profile minimal --component rustfmt,clippy \
            --target wasm32-unknown-unknown,aarch64-linux-android,x86_64-linux-android
        "$bin/exact-sandbox-run" bash -eu -c 'cd "$EXACT"; bun install --frozen-lockfile; cargo fetch --locked'
        "$bin/exact-sandbox-run" bash -eu -c 'cd "$EXACT"; cargo fetch --offline --locked'
        "$bin/exact-sandbox-run" bun /home/exact/sdk/scripts/exact.mjs --help >/dev/null
        touch "$root/runner/ready-$release"
    fi
}

if [[ $mode == all ]]; then
    prepare_ios
fi
prepare_xtool
prepare_android
prepare_exact

cat > "$bin/exact-sandbox-devices" <<'DEVICES'
#!/usr/bin/env bash
# Boot or stop the prepared devices. This command never installs packages.
set -euo pipefail
root="$HOME/.local/share/exact-sandbox"
phone="$HOME/.local/share/agent-sim/src/scripts/phone.sh"
. "$root/settings"
export ANDROID_HOME ANDROID_AVD_HOME
export XDG_RUNTIME_DIR="/run/user/$(id -u)"
export DBUS_SESSION_BUS_ADDRESS="unix:path=$XDG_RUNTIME_DIR/bus"
adb="$ANDROID_HOME/platform-tools/adb"
emulator="$ANDROID_HOME/emulator/emulator"
serial=emulator-5558
unit=exact-sandbox-android
mkdir -p "$root/logs"

android_ready() { [[ $(timeout 5 "$adb" -s "$serial" shell getprop sys.boot_completed 2>/dev/null | tr -d '\r') == 1 ]]; }

start_android() {
    [[ -x "$emulator" ]] || { echo 'Android emulator is not prepared.' >&2; return 1; }
    if [[ ! -r /dev/kvm || ! -w /dev/kvm ]]; then
        [[ -c /dev/kvm ]] || { echo 'Android emulator requires /dev/kvm on this VM.' >&2; return 1; }
        sudo -n setfacl -m "u:$(id -u):rw" /dev/kvm
    fi
    "$emulator" -accel-check
    if ! systemctl --user is-active --quiet "$unit"; then
        systemd-run --user --quiet --collect --unit="$unit" \
            --setenv="ANDROID_HOME=$ANDROID_HOME" --setenv="ANDROID_AVD_HOME=$ANDROID_AVD_HOME" \
            --property="StandardOutput=append:$root/logs/android.log" --property="StandardError=inherit" \
            "$emulator" -avd "$ANDROID_AVD" -port 5558 -accel on -gpu swiftshader -cores 2 -memory 3072 \
            -no-window -no-audio -no-boot-anim
    fi
}

wait_android() {
    for ((i=0; i<180; i++)); do
        if android_ready; then echo "Android ready ($serial)"; return; fi
        systemctl --user is-active --quiet "$unit" || break
        sleep 2
    done
    echo "Android failed to boot. See $root/logs/android.log" >&2
    return 1
}

phone_command() {
    local action=$1 device=$2
    local dir="$HOME/.local/share/x86sim/var/device-a64-$device" runtime build cache
    [[ -f "$dir/.agent-sim-granted" ]] || {
        echo "iOS device $device is not prepared." >&2; return 1;
    }
    runtime=$(<"$dir/runtime")
    build=${runtime%-arm64}
    build=${build##*-}
    cache="$HOME/.cache/x86sim/jc-$build"
    mkdir -p "$(dirname "$cache")"
    if [[ ! -e "$cache" && ! -L "$cache" ]]; then
        ln -s "$root/ios/jc-$build" "$cache"
    fi
    # Darling's overlay has to live on a local disk even if the home is restoring.
    A64_DPREFIX="/var/tmp/exact-ios-$(id -u)-$device" LP_NUM_THREADS=2 "$phone" "$action" "$device"
}

wait_local_home() {
    # Boat shows files before restoring their contents. An early Darling mount can bind
    # the temporary FUSE mount. On an already-local filesystem this returns immediately.
    local i
    for ((i=0; i<300; i++)); do
        case $(findmnt -T "$HOME" -n -o FSTYPE) in fuse*) sleep 2 ;; *) return ;; esac
    done
    echo 'Home is still being restored. Retry when the provider finishes.' >&2
    return 1
}

start_ios() {
    local device=$1 started=$SECONDS snapshot
    if ! systemctl --user is-active --quiet "agent-sim-phone-$device"; then
        phone_command start "$device"
    fi
    # x86Sim's pixel heuristic can miss Home with the iPhone 18 Pro wallpaper.
    # Check a fresh accessibility response from an app or the SpringBoard icons.
    while (( SECONDS - started < 360 )); do
        if snapshot=$(timeout 12 "$HOME/.local/bin/agent-sim" --device "$device" snapshot --json 2>/dev/null) &&
            jq -e '
                (.elements | length > 0) and
                ((.app != null and (.app_not_answering | not)) or
                 ([.elements[].label | select(. == "Safari" or . == "Files" or . == "Settings" or . == "Messages")]
                  | unique | length >= 2))
            ' >/dev/null <<< "$snapshot"; then
            printf 'iOS ready (%s) after %ss\n' "$device" "$((SECONDS - started))"
            return
        fi
        systemctl --user is-active --quiet "agent-sim-phone-$device" || break
        sleep 2
    done
    echo "iOS device $device did not become ready. See journalctl --user -u agent-sim-phone-$device." >&2
    return 1
}

action=${1:-up}
target=${2:-all}
case "$target" in all|android|pool1|pool2) ;; *) echo "Unknown device: $target" >&2; exit 2 ;; esac
case "$action" in
    up|down)
        if [[ ${EXACT_SANDBOX_DEVICE_LOCKED:-0} != 1 ]]; then
            # ADB may daemonize while a device starts. Keep the lock out of its process.
            exec flock --close "$root/devices.lock" env EXACT_SANDBOX_DEVICE_LOCKED=1 "$0" "$action" "$target"
        fi
        ;;
esac
case "$action" in
    up)
        wait_local_home
        if [[ $target == all || $target == android ]]; then start_android; fi
        if [[ $target == all ]]; then
            if [[ -w /sys/kernel/mm/ksm/run ]] || sudo -n test -w /sys/kernel/mm/ksm/run; then
                printf '1\n' | sudo -n tee /sys/kernel/mm/ksm/run >/dev/null || true
            fi
            start_ios pool1
            start_ios pool2
        elif [[ $target == pool1 || $target == pool2 ]]; then
            start_ios "$target"
        fi
        if [[ $target == all || $target == android ]]; then wait_android; fi
        ;;
    down)
        if [[ $target == all || $target == pool2 ]]; then phone_command stop pool2; fi
        if [[ $target == all || $target == pool1 ]]; then phone_command stop pool1; fi
        if [[ $target == all || $target == android ]]; then
            if systemctl --user is-active --quiet "$unit"; then
                if android_ready && ! timeout 90 "$adb" -s "$serial" emu avd snapshot save default_boot; then
                    echo 'Android Quick Boot save failed. The next start may cold boot.' >&2
                fi
                "$adb" -s "$serial" emu kill || systemctl --user stop "$unit"
                for ((i=0; i<60; i++)); do
                    systemctl --user is-active --quiet "$unit" || break
                    sleep 1
                done
            fi
        fi
        ;;
    status)
        if [[ $target == all || $target == android ]]; then
            if android_ready; then echo "Android ready ($serial)"; else echo 'Android unavailable'; fi
        fi
        for device in pool1 pool2; do
            if [[ $target == all || $target == "$device" ]]; then
                printf '%s: ' "$device"
                if systemctl --user is-active --quiet "agent-sim-phone-$device"; then echo running; else echo stopped; fi
            fi
        done
        ;;
    take)
        exec "$HOME/.local/bin/agent-sim" pool take
        ;;
    release)
        [[ $target == pool1 || $target == pool2 ]] || { echo 'Supply pool1 or pool2 to release.' >&2; exit 2; }
        A64_DPREFIX="/var/tmp/exact-ios-$(id -u)-$target" LP_NUM_THREADS=2 "$HOME/.local/bin/agent-sim" pool release "$target"
        ;;
    *) echo 'Usage: exact-sandbox-devices {up|down|status|take|release} [all|android|pool1|pool2]' >&2; exit 2 ;;
esac
DEVICES
chmod 755 "$bin/exact-sandbox-devices"

if [[ $mode == all && ${EXACT_SANDBOX_AUTOSTART:-0} == 1 ]]; then
    unit="$root/exact-sandbox-devices.service"
    cat > "$unit" <<UNIT
[Unit]
Description=Start the Exact development devices
After=systemd-user-sessions.service user@$(id -u).service
Wants=user@$(id -u).service

[Service]
Type=oneshot
User=$(id -un)
ExecStart=$bin/exact-sandbox-devices up
ExecStop=$bin/exact-sandbox-devices down
TimeoutStartSec=1800
TimeoutStopSec=240
RemainAfterExit=yes

[Install]
WantedBy=multi-user.target
UNIT
    sudo -n install -m 644 "$unit" /etc/systemd/system/exact-sandbox-devices.service
    sudo -n systemctl daemon-reload
    sudo -n systemctl enable exact-sandbox-devices.service
fi

log "Prepared $mode profile. Use $bin/exact-sandbox-run for CI and $bin/exact-sandbox-devices up for development."
