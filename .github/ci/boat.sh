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
export PATH="$HOME/.local/bin:$CARGO_HOME/bin:$PATH"
export ANDROID_HOME="$exact_root/android" ANDROID_SDK_ROOT="$exact_root/android"
export JAVA_HOME=/usr/lib/jvm/java-21-openjdk-amd64
export GRADLE_USER_HOME="$exact_root/gradle"
export PATH="$ANDROID_HOME/cmdline-tools/latest/bin:$ANDROID_HOME/platform-tools:$PATH"
export CHROME=/usr/bin/google-chrome
mkdir -p "$HOME/.cache"
ln -sfnT "$exact_root/cache" "$HOME/.cache/exact"
ENV
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
exec bun "$EXACT/scripts/exact.mjs" "$@"
CLI
  chmod +x "$bin/exact"
  cd "$EXACT"
  exact setup --platform web
  bash "$0" prepare-android
  bash "$0" smoke "$ref" android
  install -m 755 "$0" "$root/boat-smoke.sh"
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
  "$sdk" --sdk_root="$ANDROID_HOME" 'platform-tools' 'platforms;android-37.2' 'build-tools;37.0.0' 'ndk;27.3.13750724'
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
  if [[ ${3:-} == android ]]; then
    test ! -e "$ANDROID_HOME/emulator"
    test ! -e "$ANDROID_HOME/system-images"
    export ANDROID_USER_HOME="$fixture/android-home"
    time bun exact.mjs android --no-install --json > android.json
    apk=$(jq -er '.path | select(endswith(".apk"))' android.json)
    test -s "$apk"
    unzip -tq "$apk"
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
producer=$(boat new --type default --no-env --ttl 5400 --name exact-snapshot-producer --json \
  --file "/tmp/exact-boat.sh=$script_dir/boat.sh" --file "/tmp/checkout.sh=$script_dir/checkout.sh" | ready_id)
boat exec --timeout 3600 --stream "$producer" -- bash /tmp/exact-boat.sh prepare "$ref" "$bun_version"
boat stop "$producer"
wait_for "$producer" '.sandbox.state == "stopped" and .sandbox.stop.status == "completed" and .sandbox.holdsCreatorLogins == false'

started=$SECONDS
sandbox=$(boat fork --wait --no-env --no-snapshots --type default --ttl 2400 --json "$producer" | ready_id)
echo "Boat shell ready in $((SECONDS - started))s"
boat exec --timeout 1800 --stream "$sandbox" -- bash /home/user/.local/share/exact-boat/boat-smoke.sh smoke "$ref" android
wait_for "$sandbox" '.sandbox.hydrated == true'
echo "Boat Android build, web smoke, and hydration verified by $((SECONDS - started))s"
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
