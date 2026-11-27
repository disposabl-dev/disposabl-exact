#!/usr/bin/env bash
set -euo pipefail

upstream=https://github.com/expo/exact.git
name=exact-dev
script_dir=$(cd "$(dirname "$0")" && pwd)

if [[ ${1:-} == prepare ]]; then
  ref=${2:?Expected an Exact commit}
  bun_version=${3:?Expected a Bun version}
  [[ $ref =~ ^[0-9a-f]{40}$ && $bun_version =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]
  root="$HOME/.local/share/exact-boat"
  bin="$HOME/.local/bin"
  mkdir -p "$root" "$bin" "$HOME/.cache"
  export BUN_INSTALL="$HOME/.local"
  curl -fsSL --retry 3 https://bun.sh/install | bash -s "bun-v$bun_version"
  bash "$script_dir/checkout.sh" "$ref" "$root/sdk"
  cat > "$root/env.sh" <<'ENV'
exact_root="$HOME/.local/share/exact-boat"
export EXACT="$exact_root/sdk"
export CARGO_HOME="$exact_root/cargo" RUSTUP_HOME="$exact_root/rustup"
export CARGO_TARGET_DIR="${CARGO_TARGET_DIR:-$exact_root/target}"
export CARGO_INCREMENTAL=0 CARGO_BUILD_JOBS=3
export ANDROID_HOME="$exact_root/android" ANDROID_SDK_ROOT="$exact_root/android"
export JAVA_HOME=/usr/lib/jvm/java-21-openjdk-amd64
export GRADLE_USER_HOME="$exact_root/gradle"
export EXACT_APPLE_ROOT="${EXACT_APPLE_ROOT:-$exact_root/apple}"
export RUNNER_TEMP="${RUNNER_TEMP:-$exact_root/tmp}"
exact_boat_path="$HOME/.local/bin:$CARGO_HOME/bin:$ANDROID_HOME/cmdline-tools/latest/bin:$ANDROID_HOME/platform-tools"
case "$PATH" in
  "$exact_boat_path"|"$exact_boat_path":*) ;;
  *) export PATH="$exact_boat_path:$PATH" ;;
esac
export CHROME=/usr/bin/google-chrome
# Exact's browser profile lock requires real directories, separate from the SDK cache symlink.
export XDG_CACHE_HOME="${XDG_CACHE_HOME:-$HOME/.cache/exact-boat}"
mkdir -p "$HOME/.cache" "$XDG_CACHE_HOME"
ln -sfnT "$exact_root/cache" "$HOME/.cache/exact"
ENV
  login_hook='[ ! -r "$HOME/.local/share/exact-boat/env.sh" ] || . "$HOME/.local/share/exact-boat/env.sh"'
  for profile in "$HOME/.profile" "$HOME/.bashrc"; do
    grep -Fqx "$login_hook" "$profile" || printf '\n%s\n' "$login_hook" >> "$profile"
  done
  mkdir -p "$root/cache" "$root/cargo/bin"
  install -m 755 "$(command -v rustup)" "$root/cargo/bin/rustup"
  for tool in cargo rustc rustdoc rustfmt cargo-fmt cargo-clippy clippy-driver; do
    ln "$root/cargo/bin/rustup" "$root/cargo/bin/$tool"
  done
  source "$root/env.sh"
  cat > "$bin/exact" <<'CLI'
#!/usr/bin/env bash
set -euo pipefail
source "$HOME/.local/share/exact-boat/env.sh"
case "${1:-}" in
  ios|mac)
    [[ -f exact.mjs ]] || { echo 'Run this command from an Exact app directory.' >&2; exit 1; }
    platform=$1
    [[ "$platform" != mac ]] || platform=macos
    mkdir -p "$RUNNER_TEMP"
    bash "$HOME/.local/share/exact-boat/native.sh" prepare "$platform" >&2
    export EXACT_APPLE_SDK="$EXACT_APPLE_ROOT/$platform" EXACT_APPLE_LLVM_BIN=/usr/lib/llvm-23/bin
    export PATH="$EXACT_APPLE_ROOT/bin:$EXACT_APPLE_ROOT/swift/usr/bin:$EXACT_APPLE_LLVM_BIN:$PATH"
    [[ "$platform" != macos ]] || export EXACT_IDENTITY="${EXACT_IDENTITY:--}"
    exec bun exact.mjs "$@" ;;
  *) exec bun "$EXACT/scripts/exact.mjs" "$@" ;;
esac
CLI
  chmod +x "$bin/exact"
  cd "$EXACT"
  exact setup --platform web
  bash "$0" prepare-android
  install -m 755 "$0" "$root/boat-smoke.sh"
  for file in native.sh apple-linux.sh apple-linux-compat.py swift-6-release.asc; do
    install -m 644 "$script_dir/$file" "$root/$file"
  done
  # Warm open toolchain and compiled caches in the private producer. Remove
  # downloaded Apple SDK trees before the producer can become a snapshot.
  bash "$root/boat-smoke.sh" smoke "$ref" all
  rm -rf -- "$EXACT_APPLE_ROOT/ios" "$EXACT_APPLE_ROOT/macos"
  rm -f -- "$EXACT_APPLE_ROOT/ios-27.1.ready" "$EXACT_APPLE_ROOT/macos-27.0.ready"
  test ! -e "$EXACT_APPLE_ROOT/ios" && test ! -e "$EXACT_APPLE_ROOT/macos"
  printf '%s\n' "$ref" > "$root/prepared"
  exit
fi

if [[ ${1:-} == prepare-android ]]; then
  source "$HOME/.local/share/exact-boat/env.sh"
  mkdir -p "$GRADLE_USER_HOME"
  printf '%s\n' 'org.gradle.jvmargs=-Xmx3g -Dfile.encoding=UTF-8' 'org.gradle.workers.max=2' > "$GRADLE_USER_HOME/gradle.properties"
  work=$(mktemp -d)
  trap 'rm -rf "$work"' EXIT
  sudo -n apt-get -q -o Acquire::Retries=3 update
  sudo -n apt-get -qy -o Acquire::Retries=3 install --no-install-recommends openjdk-21-jdk-headless
  tools="$ANDROID_HOME/cmdline-tools/latest"
  mkdir -p "$(dirname "$tools")"
  curl -fsSL --retry 3 https://dl.google.com/android/repository/commandlinetools-linux-16111833_latest.zip -o "$work/android.zip"
  printf '%s  %s\n' e025545c62a8e64c7559119566a569fb1dec5f60 "$work/android.zip" | sha1sum -c -
  unzip -q "$work/android.zip" -d "$work"
  mv "$work/cmdline-tools" "$tools"
  sdk="$tools/bin/sdkmanager"
  (set +o pipefail; yes | "$sdk" --sdk_root="$ANDROID_HOME" --licenses >/dev/null)
  "$sdk" --sdk_root="$ANDROID_HOME" 'platform-tools' 'platforms;android-37.2' 'ndk;27.3.13750724'
  bash "$script_dir/android-tools.sh" install
  cd "$EXACT"
  rustup target add aarch64-linux-android x86_64-linux-android
  cargo run --locked --manifest-path vendor/ibex/crates/hermes-lean-sys-installer/Cargo.toml -- \
    --target aarch64-linux-android --target x86_64-linux-android
  exit
fi

if [[ ${1:-} == smoke ]]; then
  test "$(nproc)" -eq 4
  awk '/MemTotal/ {exit !($2 >= 7000000 && $2 <= 9000000)}' /proc/meminfo
  source "$HOME/.local/share/exact-boat/env.sh"
  test "$(git -C "$EXACT" rev-parse HEAD)" = "$2"
  for path in "$HOME"/{.netrc,.git-credentials,.config/gh/hosts.yml,.codex/auth.json,.claude/.credentials.json,.swiftpm/swift-sdks/darwin.artifactbundle,.local/share/x86sim/runtimes}; do
    [[ ! -e $path ]] || { echo "Unexpected snapshot path: $path" >&2; exit 1; }
  done
  fixture=$(mktemp -d)
  trap 'rm -rf "$fixture"' EXIT
  exact new "$fixture/app" --name BoatSmoke --bundle-id dev.boat.exact.smoke
  cd "$fixture/app"
  if [[ ${3:-} == android || ${3:-} == all ]]; then
    test ! -e "$ANDROID_HOME/emulator"
    test ! -e "$ANDROID_HOME/system-images"
    export ANDROID_USER_HOME="$fixture/android-home"
    time bun exact.mjs android --no-install --json > android.json
    apk=$(jq -er '.path | select(endswith(".apk"))' android.json)
    test -s "$apk"
    unzip -tq "$apk"
  fi
  if [[ ${3:-} == all ]]; then
    export RUNNER_TEMP="$fixture/runner"
    mkdir -p "$RUNNER_TEMP"
    # Run precisely the launcher commands available in a restored sandbox.
    exact ios --device --release --unsigned --archive "$fixture/app.ipa" --json > "$fixture/ios.json"
    unzip -tq "$fixture/app.ipa" >/dev/null
    unzip -q "$fixture/app.ipa" 'Payload/*' -d "$fixture/ios"
    bundles=("$fixture"/ios/Payload/*.app)
    [[ ${#bundles[@]} == 1 && -d "${bundles[0]}" ]]
    source "$script_dir/apple-linux.sh"
    export PATH="$EXACT_APPLE_ROOT/bin:$EXACT_APPLE_ROOT/swift/usr/bin:/usr/lib/llvm-23/bin:$PATH"
    apple_verify_bundle "${bundles[0]}" ios "$fixture"
    exact mac --release --json > "$fixture/mac.json"
    bundle=$(jq -er '.path | select(endswith(".app"))' "$fixture/mac.json")
    test -d "$bundle"
    apple_verify_bundle "$bundle" macos "$fixture"
  fi
  time bun exact.mjs web-build --out dist
  test -s dist/shell.html
  exit
fi

# CI passes BOAT_API_KEY to the controller only. The sandbox receives public inputs.
if [[ -n ${BOAT_API_KEY:-} ]]; then
  printf '%s\n' "$BOAT_API_KEY" | boat login --key-stdin
fi
ref=${EXACT_REF:-$(git ls-remote "$upstream" HEAD | cut -f1)}
bun_version=${BUN_VERSION:-1.4.5}
producer=
sandbox=
trap 'if [[ -n $sandbox ]]; then boat stop "$sandbox" >&2 || true; fi
      if [[ -n $producer ]]; then boat stop "$producer" >&2 || true; fi' EXIT
ready_id() {
  jq -ers 'map(select(.event == "ready") | .id) | first // error("Boat did not become ready")'
}
wait_for() {
  local id=$1 predicate=$2 deadline=$((SECONDS + 900)) state
  while (( SECONDS < deadline )); do
    state=$(boat info "$id" --json)
    if jq -e "$predicate" <<<"$state" >/dev/null; then return; fi
    sleep 3
  done
  echo "Boat timeout waiting for $predicate on $id" >&2
  return 1
}
producer=$(boat new --type default --no-env --ttl 10800 --name exact-snapshot-producer --json \
  --file "/tmp/exact-boat.sh=$script_dir/boat.sh" --file "/tmp/checkout.sh=$script_dir/checkout.sh" --file "/tmp/android-tools.sh=$script_dir/android-tools.sh" \
  --file "/tmp/native.sh=$script_dir/native.sh" --file "/tmp/apple-linux.sh=$script_dir/apple-linux.sh" \
  --file "/tmp/apple-linux-compat.py=$script_dir/apple-linux-compat.py" --file "/tmp/swift-6-release.asc=$script_dir/swift-6-release.asc" | ready_id)
boat exec --timeout 7200 --stream "$producer" -- bash /tmp/exact-boat.sh prepare "$ref" "$bun_version"
boat stop "$producer"
wait_for "$producer" '.sandbox.state == "stopped" and .sandbox.stop.status == "completed" and .sandbox.holdsCreatorLogins == false'

started=$SECONDS
sandbox=$(boat fork --wait --no-env --no-snapshots --type default --ttl 7200 --json "$producer" | ready_id)
echo "Boat shell ready in $((SECONDS - started))s"
boat exec --timeout 5400 --stream "$sandbox" -- bash -lc '
  set -e
  root="$HOME/.local/share/exact-boat"
  test "$EXACT" = "$root/sdk"
  test "$ANDROID_HOME" = "$root/android"
  test "$RUSTUP_HOME" = "$root/rustup"
  test "$(command -v rustup)" = "$root/cargo/bin/rustup"
  test -x "$EXACT_APPLE_ROOT/swift/usr/bin/swiftc"
  test -x "$EXACT_APPLE_ROOT/bin/xtool"
  test ! -e "$EXACT_APPLE_ROOT/ios" && test ! -e "$EXACT_APPLE_ROOT/macos"
  exec bash "$root/boat-smoke.sh" smoke "$1" all
' boat-smoke "$ref"
wait_for "$sandbox" '.sandbox.hydrated == true'
echo "Boat Android, Apple, and web builds and hydration verified by $((SECONDS - started))s"
boat stop "$sandbox"
sandbox=

boat snapshot "$producer" "$name"
producer=
if [[ -n ${GITHUB_STEP_SUMMARY:-} ]]; then
  {
    printf 'Exact %s passed a fresh 4 vCPU, 8 GB Boat restore.\n\n' "$ref"
    shares=$(boat snapshot shares "$name" --json)
    if jq -e 'any(.shares[]; .status == "active")' <<<"$shares" >/dev/null; then
      printf 'The existing share code now deploys this snapshot.\n\n'
      printf '```sh\nboat new --type default --no-env --from "$EXACT_BOAT_SHARE_CODE"\n```\n'
    else
      share_code=$(boat snapshot share "$name" --json | jq -er '.shareCode | select(startswith("bsh_"))')
      printf '```sh\nboat new --type default --no-env --from %s\n```\n' "$share_code"
    fi
  } >> "$GITHUB_STEP_SUMMARY"
fi
