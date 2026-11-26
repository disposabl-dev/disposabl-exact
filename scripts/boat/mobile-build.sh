#!/usr/bin/env bash
# One Linux setup and build entry point for Exact mobile compiler caches.
set -euo pipefail

cache_root=$(realpath -m "${EXACT_MOBILE_CACHE_DIR:-$HOME/.local/share/exact-boat/mobile}")
source_revision=${EXACT_MOBILE_SETUP_REV:-b6d561fa33109ee6bb0602c3378a2f5a8690a065}
cleanup=()
volumes=()
overlay_dir=
overlay_image=

cleanup_exit() {
    local status=$1 scratch
    if (( ${#volumes[@]} )); then
        docker volume rm "${volumes[@]}" >/dev/null || exit 1
        # OverlayFS creates some root-owned directories in its work area.
        docker run --rm --user 0:0 -v "$overlay_dir:/scratch" "$overlay_image" \
            bash -ec 'shopt -s nullglob; for path in /scratch/overlay-*; do rm -rf -- "$path"; done' || status=1
    fi
    for scratch in "${cleanup[@]}"; do rm -rf -- "$scratch" || status=1; done
    exit "$status"
}
trap 'cleanup_exit "$?"' EXIT

usage() {
    cat >&2 <<EOF
Usage:
  $0 prepare ios|android
  $0 ios EXACT_REF APP_DIRECTORY OUTPUT.ipa
  $0 android EXACT_REF APP_DIRECTORY OUTPUT.apk
  $0 save-image ios|android EXACT_REF
  $0 load-image ios|android EXACT_REF
  $0 export ios|android EXACT_REF OUTPUT.tar.zst
  $0 restore CACHE.tar.zst
EOF
    exit 2
}

capture_ios() {
    local seed image sdk target ref image_id prefix crate marker root bundle directory toolchain
    local -a filters
    seed=$(realpath "$1")
    image=$2
    shift 2
    sdk=work/_temp/exact-sdk
    target="$seed/.cache/exact-native/cargo"
    ref=$(git -C "$seed/$sdk" rev-parse HEAD)
    [[ $ref =~ ^[0-9a-f]{40}$ && -d "$target/apple-swift" ]]
    image_id=$(docker image inspect --format '{{.Id}}' "$image")
    [[ $(docker image inspect --format '{{.Os}}/{{.Architecture}}' "$image") == linux/amd64 ]]

    filters=(--exclude=incremental --exclude='*.lock' --exclude='*.flock'
        --exclude='*.ipa' --exclude='*.app' --exclude='*.receipt.json' --exclude='*.build.json'
        --exclude='*.dSYM' --exclude='*.dSYMs' --exclude='*.linked'
        --exclude=ExactIOS --exclude=ExactIOS.build --exclude=ExactMac --exclude=ExactMac.build
        --exclude='*-entitlements.plist')
    for prefix in "$@"; do
        [[ $prefix =~ ^[a-z][a-z0-9-]*$ ]]
        crate="${prefix//-/_}_apple"
        filters+=(--exclude="$prefix-apple-*" --exclude="$crate*" --exclude="lib$crate*")
    done
    if [[ -d "$target/.exact-crates" ]]; then
        for marker in "$target"/.exact-crates/*; do
            [[ -f "$marker" ]] || continue
            [[ " $* " == *" ${marker##*/} "* ]] || {
                echo "Specify the public fixture crate prefix ${marker##*/}." >&2
                exit 1
            }
        done
    fi

    root=$cache_root/ios
    mkdir -p "$root"
    [[ ! -e "$root/$ref" ]]
    bundle=$(mktemp -d "$root/.prepare.XXXXXXXX")
    cleanup+=("$bundle")
    mkdir -p "$bundle/home" "$bundle/cache" "$bundle/target"

    # Preserve absolute paths inside the container and source mtimes for Cargo and SwiftPM.
    rsync -aH --relative "$seed/./$sdk" "$seed/./.rustup" \
        "$seed/./.cargo/registry" "$seed/./.cargo/hermes-lean-sys" "$bundle/home/"
    rsync -aH --relative "$seed/.cache/./exact/publisher/$ref" "$bundle/cache/"
    for directory in balanced aarch64-apple-ios/balanced apple-modules apple-swift exact-filesystem-tool; do
        [[ ! -d "$target/$directory" ]] || rsync -aH --relative "${filters[@]}" "$target/./$directory" "$bundle/target/"
    done

    docker tag "$image_id" "exact-boat-ios:$ref"
    toolchain=$(docker run --rm --entrypoint swiftc "exact-boat-ios:$ref" --version | sed -n '1p')
    jq -n --arg ref "$ref" --arg image "$image_id" --arg swift "$toolchain" \
        '{format:1, exactRef:$ref, imageId:$image, swift:$swift, target:"aarch64-apple-ios", profile:"balanced"}' > "$bundle/manifest.json"
    chmod 755 "$bundle"
    mv -T -- "$bundle" "$root/$ref"
    printf 'Prepared Linux iOS compiler cache %s\n' "$root/$ref"
}

prepare() {
    local platform=$1 work setup pin ref bun_version bundle_version image cache_lock
    [[ "$source_revision" =~ ^[0-9a-f]{40}$ ]]
    work=$(mktemp -d)
    cleanup+=("$work")
    setup="$work/setup"
    git init -q "$setup"
    git -C "$setup" fetch -q --depth=1 https://github.com/disposabl-dev/disposabl-exact.git "$source_revision"
    git -C "$setup" checkout -q --detach FETCH_HEAD
    pin="$setup/.github/actions/exact-setup/pin.env"
    ref=$(sed -n 's/^exact-ref=//p' "$pin")
    bun_version=$(sed -n 's/^bun-version=//p' "$pin")
    bundle_version=$(sed -n 's/^bundle-version=//p' "$pin")
    [[ $ref =~ ^[0-9a-f]{40}$ && $bun_version == 1.4.5 && $bundle_version =~ ^[0-9]+$ ]]
    mkdir -p "$cache_root/$platform"
    exec {cache_lock}< "$cache_root/$platform"
    flock -x "$cache_lock"
    if [[ -d "$cache_root/$platform/$ref" ]]; then
        verify_cache "$platform" "$ref"
        if [[ "$platform" == android ]] && ! android_sdk_ready "$cache_root/android/$ref/sdk"; then
            mkdir -p "$work/repair-home"
            docker run --rm --network=host --user "$(id -u):$(id -g)" \
                -v "$work/repair-home:/home/runner" \
                -v "$cache_root/android/$ref/sdk:/usr/local/lib/android/sdk" \
                -v "$(realpath "$0"):/mobile-build.sh:ro" \
                "exact-boat-android:$ref" bash /mobile-build.sh _android-sdk
        fi
        printf 'Compiler cache already prepared for %s %s\n' "$platform" "$ref"
        return
    fi

    image="exact-boat-$platform:$ref"
    docker build --target "$platform" --tag "$image" --file - "$setup" <<'DOCKER'
FROM buildpack-deps:26.04@sha256:194c70abaf37ac12f2aadca115308af03f90cbf60c1ffbd3afc4a7a451f65368 AS android
RUN apt-get -o Acquire::Retries=3 update -qq \
 && DEBIAN_FRONTEND=noninteractive apt-get install -y -qq --no-install-recommends openjdk-21-jdk-headless rustup time zip unzip zstd jq python3 rsync gpg \
 && rm -rf /var/lib/apt/lists/* \
 && usermod --home /home/runner ubuntu \
 && mkdir -p /home/runner \
 && curl -fsSL --retry 3 https://github.com/oven-sh/bun/releases/download/bun-v1.4.5/bun-linux-x64.zip -o /tmp/exact-bun.zip \
 && echo '94559b3b528995a49452f9f2404cec74f2efd7d06e0a000a8cd214b02c3666eb  /tmp/exact-bun.zip' | sha256sum -c - \
 && unzip -p /tmp/exact-bun.zip bun-linux-x64/bun > /usr/local/bin/bun \
 && chmod 755 /usr/local/bin/bun && rm /tmp/exact-bun.zip \
 && ln -s /usr/bin/rustup /usr/local/bin/cargo && ln -s /usr/bin/rustup /usr/local/bin/rustc
ENV HOME=/home/runner JAVA_HOME=/usr/lib/jvm/java-21-openjdk-amd64

FROM android AS ios
COPY .github/actions/exact-setup/scripts/apple-linux-tools.sh .github/actions/exact-setup/scripts/apple-linux-sdk.sh .github/actions/exact-setup/scripts/swift-6-release.asc /opt/exact-installer/
RUN install -d /opt/exact-tools \
 && export RUNNER_TEMP=/opt/exact-tools GITHUB_PATH=/tmp/exact-path GITHUB_ENV=/tmp/exact-env \
 && bash /opt/exact-installer/apple-linux-tools.sh \
 && export PATH="$(paste -sd: /tmp/exact-path):$PATH" \
 && set -a && . /tmp/exact-env && set +a \
 && bash /opt/exact-installer/apple-linux-sdk.sh ios \
 && apt-get clean && rm -rf /var/lib/apt/lists/*
ENV PATH=/opt/exact-tools/exact-apple-tools/swift/usr/bin:/usr/lib/llvm-23/bin:/opt/exact-tools/exact-apple-tools:$PATH
ENV EXACT_APPLE_SDK=/opt/exact-tools/exact-darwin-27.1 EXACT_APPLE_LLVM_BIN=/usr/lib/llvm-23/bin APPIMAGE_EXTRACT_AND_RUN=1
DOCKER

    mkdir "$work/home"
    local -a mounts=()
    if [[ "$platform" == android ]]; then
        mkdir "$work/android-sdk"
        mounts+=(-v "$work/android-sdk:/usr/local/lib/android/sdk")
    fi
    docker run --rm --network=host --user "$(id -u):$(id -g)" \
        -v "$work/home:/home/runner" -v "$setup:/setup:ro" -v "$(realpath "$0"):/mobile-build.sh:ro" \
        "${mounts[@]}" "$image" bash /mobile-build.sh _seed "$platform" "$ref" "$bun_version" "$bundle_version"
    if [[ "$platform" == ios ]]; then
        capture_ios "$work/home" "$image" apps
    else
        capture_android "$work/home" "$image" "$work/android-sdk" "$setup"
    fi
}

seed_ios() {
    local ref=$1 bun_version=$2 bundle_version=$3 scripts=/setup/.github/actions/exact-setup/scripts
    local release="https://github.com/disposabl-dev/disposabl-exact/releases/download/v$bundle_version-exact-$ref-bun-$bun_version"
    local web="exact-$ref-web-Linux-X64-bun-$bun_version.tar.zst"
    export EXACT_REF="$ref" SETUP_EXACT_REF="$ref" EXACT="$HOME/work/_temp/exact-sdk"
    export RUNNER_TEMP="$HOME/seed" GITHUB_ENV="$HOME/seed/env"
    export CARGO_TARGET_DIR="$HOME/.cache/exact-native/cargo"
    export CARGO_PROFILE_RELEASE_LTO=off CARGO_PROFILE_RELEASE_CODEGEN_UNITS=16
    export CARGO_PROFILE_BALANCED_LTO=off CARGO_PROFILE_SIZE_LTO=off CARGO_BUILD_JOBS=6
    mkdir -p "$RUNNER_TEMP" "$EXACT" "$CARGO_TARGET_DIR"
    python3 "$scripts/release-manifest.py" "$bundle_version" "$ref" "$bun_version" "$RUNNER_TEMP/inputs.json"
    python3 "$scripts/fetch-input.py" "$release" "$RUNNER_TEMP/inputs.json" sdk.tar.zst "$RUNNER_TEMP/sdk.tar.zst"
    python3 "$scripts/fetch-input.py" "$release" "$RUNNER_TEMP/inputs.json" "$web" "$RUNNER_TEMP/web.tar.zst"
    tar --zstd -xf "$RUNNER_TEMP/sdk.tar.zst" -C "$EXACT"
    tar --zstd -xf "$RUNNER_TEMP/web.tar.zst" -C "$HOME" ".cache/exact/publisher/$ref"
    git -C "$EXACT" reset --hard -q HEAD
    [[ $(git -C "$EXACT" rev-parse HEAD) == "$ref" ]]
    (cd "$EXACT" && bun install --frozen-lockfile)
    bun "$scripts/ios-baker.mjs" patch
    bash "$scripts/prepare-apple.sh" ios bootstrap
    export EXACT_IOS_BAKER_PATH="$HOME/.cache/exact/publisher/$ref/exact-js-bake"
    export EXACT_IOS_BAKER_SHA256="$(sha256sum "$EXACT_IOS_BAKER_PATH" | cut -d ' ' -f1)"

    git -c safe.directory=/setup clone -q --no-local /setup "$HOME/public-fixture"
    export GITHUB_REPOSITORY=disposabl-dev/disposabl-exact
    export GITHUB_SHA="$(git -C "$HOME/public-fixture" rev-parse HEAD)"
    cd "$HOME/public-fixture/apps/apps"
    mkdir -p .exact
    ln -s "$EXACT" .exact/checkout
    bun install --frozen-lockfile
    bun scripts/locales.mjs
    export EXACT_UPDATE_TRUST=production EXACT_UPDATE_GENESIS=1 EXACT_MOBILE_CHANNEL=base-1
    export EXACT_BUILD_NUMBER=1 EXACT_FEEDBACK=0
    export CONVEX_ORIGIN=wss://public-cache.invalid CONVEX_SITE_ORIGIN=https://public-cache.invalid
    EXACT_UPDATE_SEED="$(openssl rand -base64 32)" bun "$scripts/mobile-updates.mjs" configure ios
    export EXACT_BAKE_OUTPUT="$RUNNER_TEMP/bake"
    bun exact.mjs ios --device --release --unsigned --archive "$RUNNER_TEMP/public.ipa" --json
    jq -e '.trust == "production" and .compat.inputs.store.L == "A"' \
        "$EXACT_BAKE_OUTPUT/ios-aarch64-apple-ios.build.json" >/dev/null
}

android_sdk_ready() {
    local sdk=$1 package
    for package in platform-tools ndk/27.3.13750724 build-tools/36.0.0 build-tools/37.0.0 platforms/android-37.2; do
        [[ -r "$sdk/$package/source.properties" ]] || return 1
    done
}

setup_android_sdk() {
    local sdk=/usr/local/lib/android/sdk tools
    android_sdk_ready "$sdk" && return 0
    tools=$(mktemp -d)
    cleanup+=("$tools")
    curl -fsSL --retry 4 --retry-all-errors \
        https://dl.google.com/android/repository/commandlinetools-linux-16111833_latest.zip -o "$tools/android.zip"
    printf '%s  %s\n' e025545c62a8e64c7559119566a569fb1dec5f60 "$tools/android.zip" | sha1sum -c -
    unzip -q "$tools/android.zip" -d "$tools"
    local manager="$tools/cmdline-tools/bin/sdkmanager"
    (set +o pipefail; yes | "$manager" --sdk_root="$sdk" --licenses >/dev/null)
    "$manager" --sdk_root="$sdk" --install platform-tools 'platforms;android-37.2' \
        'build-tools;36.0.0' 'build-tools;37.0.0' 'ndk;27.3.13750724'
    android_sdk_ready "$sdk"
}

seed_android() {
    local ref=$1 bun_version=$2 bundle_version=$3
    local scripts=/setup/.github/actions/exact-setup/scripts
    export SETUP_PLATFORM=android SETUP_EXACT_REF="$ref" SETUP_BUN_VERSION="$bun_version" SETUP_BUNDLE_VERSION="$bundle_version"
    export RUNNER_OS=Linux RUNNER_ARCH=X64
    export EXACT="$HOME/work/_temp/exact-sdk" EXACT_REF="$ref"
    export GITHUB_WORKSPACE="$HOME/source" GITHUB_REPOSITORY=disposabl-dev/disposabl-exact
    export RUNNER_TEMP="$HOME/seed" GITHUB_ENV="$HOME/seed/env" GITHUB_OUTPUT="$HOME/seed/output"
    export ANDROID_HOME=/usr/local/lib/android/sdk ANDROID_SDK_ROOT=/usr/local/lib/android/sdk
    export GRADLE_USER_HOME="$HOME/.gradle"
    mkdir -p "$RUNNER_TEMP"
    setup_android_sdk
    git -c safe.directory=/setup clone -q --no-local /setup "$GITHUB_WORKSPACE"
    export GITHUB_SHA="$(git -C "$GITHUB_WORKSPACE" rev-parse HEAD)"
    cd "$GITHUB_WORKSPACE"
    bash "$scripts/restore.sh"
    set -a
    source "$GITHUB_ENV"
    set +a
    cd "$EXACT"
    rustup target add aarch64-linux-android
    cargo run --locked --manifest-path vendor/ibex/crates/hermes-lean-sys-installer/Cargo.toml -- --target aarch64-linux-android

    cd "$NATIVE_APP_DIR"
    export EXACT_UPDATE_TRUST=production EXACT_UPDATE_GENESIS=1 EXACT_MOBILE_CHANNEL=base-1
    export EXACT_BUILD_NUMBER=1 EXACT_FEEDBACK=0
    export CONVEX_ORIGIN=wss://public-cache.invalid CONVEX_SITE_ORIGIN=https://public-cache.invalid
    EXACT_UPDATE_SEED="$(openssl rand -base64 32)" bun "$scripts/mobile-updates.mjs" configure android
    local signing_password
    signing_password=$(openssl rand -hex 24)
    export EXACT_KEYSTORE="$RUNNER_TEMP/public-fixture.p12" EXACT_KEY_ALIAS=android
    export EXACT_KEYSTORE_PASSWORD="$signing_password" EXACT_KEY_PASSWORD="$signing_password"
    keytool -genkeypair -noprompt -storetype PKCS12 -keystore "$EXACT_KEYSTORE" \
        -storepass:env EXACT_KEYSTORE_PASSWORD -keypass:env EXACT_KEY_PASSWORD -alias android \
        -keyalg RSA -dname CN=PublicFixture -validity 2 >/dev/null 2>&1
    export EXACT_BAKE_OUTPUT="$RUNNER_TEMP/bake"
    bun exact.mjs android --release --no-install --json
    jq -e '.trust == "production" and .compat.inputs.store.L == "A"' \
        "$EXACT_BAKE_OUTPUT/android-aarch64-linux-android.build.json" >/dev/null
}

capture_android() {
    local seed image sdk_bootstrap setup sdk target ref image_id root bundle directory gradle_version
    seed=$(realpath "$1")
    image=$2
    sdk_bootstrap=$(realpath "$3")
    setup=$(realpath "$4")
    sdk=work/_temp/exact-sdk
    target="$seed/.cache/exact-native/cargo"
    ref=$(git -C "$seed/$sdk" rev-parse HEAD)
    [[ $ref =~ ^[0-9a-f]{40}$ ]]
    image_id=$(docker image inspect --format '{{.Id}}' "$image")
    [[ $(docker image inspect --format '{{.Os}}/{{.Architecture}}' "$image") == linux/amd64 ]]
    root=$cache_root/android
    mkdir -p "$root"
    [[ ! -e "$root/$ref" ]]
    bundle=$(mktemp -d "$root/.prepare.XXXXXXXX")
    cleanup+=("$bundle")
    mkdir -p "$bundle/home" "$bundle/cache" "$bundle/target" "$bundle/gradle" "$bundle/sdk"
    rsync -aH --relative "$seed/./$sdk" "$seed/./.rustup" \
        "$seed/./.cargo/registry" "$seed/./.cargo/hermes-lean-sys" "$bundle/home/"
    rsync -aH --relative "$seed/.cache/./exact/publisher/$ref" "$bundle/cache/"
    rsync -aH --relative --exclude=incremental --exclude='apps-android-*' --exclude='libapps_android*' \
        --exclude='apps_android*' --exclude='*.lock' "$target/./release" "$target/./aarch64-linux-android/release" "$bundle/target/"
    gradle_version=$(sed -nE 's#^distributionUrl=.*/gradle-([0-9A-Za-z.-]+)-(bin|all)\.zip$#\1#p' \
        "$seed/$sdk/host/android/gradle/wrapper/gradle-wrapper.properties")
    [[ -n "$gradle_version" ]]
    for directory in caches/build-cache-1 caches/modules-2 "caches/$gradle_version" wrapper/dists; do
        [[ ! -d "$seed/.gradle/$directory" ]] || rsync -aH --relative --exclude='*.lock' --exclude='*.lck' --exclude='*.part' \
            "$seed/.gradle/./$directory" "$bundle/gradle/"
    done
    printf 'org.gradle.caching=true\n' > "$bundle/gradle/gradle.properties"
    android_sdk_ready "$sdk_bootstrap"
    rsync -aH --relative "$sdk_bootstrap/./licenses" "$sdk_bootstrap/./ndk" \
        "$sdk_bootstrap/./build-tools" "$sdk_bootstrap/./platforms" "$sdk_bootstrap/./platform-tools" "$bundle/sdk/"
    cp -a "$setup/.github/actions/exact-setup/scripts" "$bundle/scripts"
    docker tag "$image_id" "exact-boat-android:$ref"
    jq -n --arg ref "$ref" --arg image "$image_id" --arg gradle "$gradle_version" \
        '{format:1,exactRef:$ref,imageId:$image,gradle:$gradle,target:"aarch64-linux-android",profile:"release"}' > "$bundle/manifest.json"
    chmod 755 "$bundle"
    mv -T "$bundle" "$root/$ref"
    printf 'Prepared Linux Android compiler cache %s\n' "$root/$ref"
}

build_mobile() {
    local platform=$1 ref=$2 app archive extension root work repository relative image
    verify_cache "$platform" "$ref"
    extension=ipa
    if [[ "$platform" == android ]]; then
        extension=apk
        : "${ANDROID_APK_SIGNING:?Supply the existing APK signing configuration}"
        android_sdk_ready "$cache_root/android/$ref/sdk" || {
            echo 'Run prepare android to install the required Android SDK packages.' >&2
            exit 1
        }
    fi
    app=$(realpath "$3")
    archive=$(realpath -m "$4")
    [[ -f "$app/app.json" && -f "$app/exact.mjs" && "$archive" == *."$extension" ]]
    [[ -d "$(dirname "$archive")" && ! -e "$archive" && ! -e "${archive%.*}.receipt.json" ]]
    root=$cache_root/$platform/$ref
    image="exact-boat-$platform:$ref"
    [[ $(git -C "$root/home/work/_temp/exact-sdk" rev-parse HEAD) == "$ref" ]]

    # A staged copy lets Exact write shells and SDK links without changing the
    # developer's checkout or the compiler cache used by the next app.
    work=$(mktemp -d "${EXACT_MOBILE_WORK_DIR:-${TMPDIR:-/tmp}}/exact-mobile.XXXXXXXX")
    cleanup+=("$work")
    mkdir -p "$work/source" "$work/output"
    repository=$(git -C "$app" rev-parse --show-toplevel 2>/dev/null || printf '%s\n' "$app")
    relative=.
    [[ "$app" == "$repository" ]] || relative=${app#"$repository"/}
    rsync -a --exclude=.git --exclude=.exact --exclude=node_modules --exclude=target \
        "$repository/" "$work/source/"

    local -a mounts=()
    cache_mounts mounts "$root" "$work" "$image" "$platform"
    if [[ "$platform" == android ]]; then
        mounts+=(-v "$root/sdk:/usr/local/lib/android/sdk:ro"
            -v "$root/scripts:/scripts:ro" -e ANDROID_APK_SIGNING)
    fi

    docker run --rm --network=host --user "$(id -u):$(id -g)" \
        -v "$work/source:/work" -v "$work/output:/output" -w "/work/$relative" \
        -v "$(realpath "$0"):/mobile-build.sh:ro" "${mounts[@]}" \
        -e HOME=/home/runner -e EXACT=/home/runner/work/_temp/exact-sdk -e EXACT_REF="$ref" \
        -e EXACT_UPDATE_TRUST=production -e EXACT_UPDATE_GENESIS -e EXACT_MOBILE_CHANNEL \
        -e EXACT_BUILD_NUMBER -e EXACT_VERSION -e EXACT_FEEDBACK=0 \
        -e CONVEX_ORIGIN -e CONVEX_SITE_ORIGIN -e CARGO_LOG \
        -e CARGO_TARGET_DIR=/home/runner/.cache/exact-native/cargo \
        -e CARGO_PROFILE_RELEASE_LTO=off -e CARGO_PROFILE_RELEASE_CODEGEN_UNITS=16 \
        -e CARGO_PROFILE_BALANCED_LTO=off -e CARGO_PROFILE_SIZE_LTO=off \
        -e CARGO_BUILD_JOBS="${CARGO_BUILD_JOBS:-6}" \
        "$image" bash /mobile-build.sh _build "$platform"
    publish_artifact "$work/output/app.$extension" "$work/output/app.receipt.json" "$archive"
    printf 'Built %s\n' "$archive"
}

cache_mounts() {
    local -n result=$1
    local root=$2 work=$3 image=$4 platform=$5 i directory host_dir volume available=true
    local -a sources=(home cache target)
    local -a destinations=(/home/runner /home/runner/.cache /home/runner/.cache/exact-native/cargo)
    if [[ "$platform" == android ]]; then
        sources+=(gradle)
        destinations+=(/home/runner/.gradle)
    fi
    overlay_dir=$work
    overlay_image=$image

    # Use isolated copy-on-write layers where the Docker host supports overlayfs.
    for i in "${!sources[@]}"; do
        directory=${sources[i]}
        host_dir="$work/overlay-$directory"
        mkdir -p "$host_dir/upper" "$host_dir/work"
        volume="exact-${work##*/}-$directory"
        if ! docker volume create --driver local --opt type=overlay --opt device=overlay \
            --opt "o=lowerdir=$root/$directory,upperdir=$host_dir/upper,workdir=$host_dir/work" "$volume" >/dev/null 2>&1; then
            available=false
            break
        fi
        volumes+=("$volume")
        result+=(--mount "type=volume,source=$volume,target=${destinations[i]},volume-nocopy")
    done
    if [[ "$available" == true ]] && docker run --rm "${result[@]}" "$image" true >/dev/null 2>&1; then
        echo 'compiler_cache_mode=overlay'
        return
    fi

    # Docker daemons that prohibit overlay mounts can use ordinary copies.
    result=()
    for i in "${!sources[@]}"; do
        directory=${sources[i]}
        cp -a --reflink=auto "$root/$directory" "$work/"
        result+=(-v "$work/$directory:${destinations[i]}")
    done
    mkdir -p "$work/home/.cache" "$work/cache/exact-native/cargo"
    if [[ "$platform" == android ]]; then
        mkdir -p "$work/home/.gradle"
    fi
    echo 'compiler_cache_mode=copy'
}

publish_artifact() {
    local binary=$1 receipt=$2 archive=$3 parent staging output_receipt
    parent=$(dirname "$archive")
    output_receipt="${archive%.*}.receipt.json"
    staging=$(mktemp -d "$parent/.exact-output.XXXXXXXX")
    cleanup+=("$staging")
    install -m 644 "$binary" "$staging/artifact"
    install -m 644 "$receipt" "$staging/receipt"
    (
        flock -x 9
        [[ ! -e "$archive" && ! -e "$output_receipt" ]]
        mv -T -- "$staging/receipt" "$output_receipt"
        if ! mv -T -- "$staging/artifact" "$archive"; then
            rm -f -- "$output_receipt"
            exit 1
        fi
    ) 9< "$parent"
}

execute_build() {
    local platform=$1 receipt
    mkdir -p .exact
    ln -s "$EXACT" .exact/checkout
    bun install --frozen-lockfile >&2
    if [[ "$platform" == ios ]]; then
        export EXACT_IOS_BAKER_PATH="$HOME/.cache/exact/publisher/$EXACT_REF/exact-js-bake"
        export EXACT_IOS_BAKER_SHA256="$(sha256sum "$EXACT_IOS_BAKER_PATH" | cut -d ' ' -f1)"
        export EXACT_BAKE_OUTPUT=/output/bake
        /usr/bin/time -f 'native_wall_s=%e' \
            bun exact.mjs ios --device --release --unsigned --archive /output/app.ipa --json >&2
        receipt=/output/app.receipt.json
        jq -e --slurpfile bake /output/bake/ios-aarch64-apple-ios.build.json \
            '.target == "aarch64-apple-ios" and .build.trust == "production" and
             .build.compat.inputs.store.L == "A" and .compatibilityId == $bake[0].compat.id
             and .build == $bake[0]' "$receipt" >/dev/null
        unzip -tq /output/app.ipa
        verify_ipa /output/app.ipa "$receipt"
    else
        export RUNNER_TEMP=/output GITHUB_OUTPUT=/output/github
        export ANDROID_HOME=/usr/local/lib/android/sdk ANDROID_SDK_ROOT=/usr/local/lib/android/sdk
        export ANDROID_NDK_HOME="$ANDROID_HOME/ndk/27.3.13750724" ANDROID_BUILD_TOOLS_VERSION=37.0.0
        export GRADLE_USER_HOME="$HOME/.gradle" ANDROID_PLAY_CONNECTED=false
        export EXACT_BAKE_OUTPUT=/output/android-artifacts/bake
        /usr/bin/time -f 'native_wall_s=%e' bash /scripts/native-build.sh android 2>&1 | sed -u '/^::add-mask::/d'
        receipt="$EXACT_BAKE_OUTPUT/android-aarch64-linux-android.build.json"
        jq -e '.trust == "production" and .compat.inputs.store.L == "A"' "$receipt" >/dev/null
        mv /output/android-artifacts/android-production.apk /output/app.apk
        mv "$receipt" /output/app.receipt.json
    fi
}

verify_ipa() {
    python3 - "$@" <<'PYTHON'
import json
import plistlib
import struct
import sys
from zipfile import ZipFile

with open(sys.argv[2], encoding="utf-8") as source:
    receipt = json.load(source)
with ZipFile(sys.argv[1]) as archive:
    plist, = [name for name in archive.namelist()
              if name.startswith("Payload/") and name.count("/") == 2 and name.endswith(".app/Info.plist")]
    app = plist.rsplit("/", 1)[0]
    info = plistlib.loads(archive.read(plist))
    executable = info["CFBundleExecutable"]
    if "/" in executable or info["CFBundleSupportedPlatforms"] != ["iPhoneOS"]:
        raise SystemExit("Expected an iPhoneOS executable")
    with archive.open(f"{app}/{executable}") as binary:
        magic, cpu, _, file_type, count, size, _, _ = struct.unpack("<8I", binary.read(32))
        if magic != 0xFEEDFACF or cpu != 0x0100000C or file_type != 2 or size > 16 * 1024 * 1024:
            raise SystemExit("Expected an arm64 Mach-O executable")
        commands = binary.read(size)
    platforms = []
    offset = 0
    for _ in range(count):
        command, length = struct.unpack_from("<2I", commands, offset)
        if length < 8 or offset + length > len(commands):
            raise SystemExit("Invalid Mach-O load command")
        if command == 0x32 and length >= 24:
            platforms.append(struct.unpack_from("<I", commands, offset + 8)[0])
        offset += length
    if 2 not in platforms:
        raise SystemExit("Expected the iPhoneOS Mach-O build platform")
    embedded = json.loads(archive.read(f"{app}/receipt.json"))
    if embedded["build"]["trust"] != "production" or embedded["compatibilityId"] != receipt["compatibilityId"]:
        raise SystemExit("The IPA's embedded OTA receipt does not match the verified release receipt")
PYTHON
}

verify_cache() {
    local platform=$1 ref=$2 image image_id expected_image archive
    [[ $ref =~ ^[0-9a-f]{40}$ ]]
    expected_image=$(jq -er --arg ref "$ref" \
        'select(.format == 1 and .exactRef == $ref) | .imageId | select(test("^sha256:[0-9a-f]{64}$"))' \
        "$cache_root/$platform/$ref/manifest.json")
    image="exact-boat-$platform:$ref"
    if ! image_id=$(docker image inspect --format '{{.Id}}' "$image" 2>/dev/null); then
        archive="$cache_root/$platform/$ref.image.tar.zst"
        [[ -r "$archive" ]] || {
            printf 'Docker image %s is missing. Restore its cache archive or save the image on the snapshot producer.\n' "$image" >&2
            return 1
        }
        # A Boat clone can restore home files before Docker has the image.
        (
            flock -x 9
            if ! docker image inspect "$expected_image" >/dev/null 2>&1; then
                /usr/bin/time -f 'image_restore_wall_s=%e' docker load --input "$archive"
            fi
            docker image tag "$expected_image" "$image"
        ) 9< "$archive"
        image_id=$(docker image inspect --format '{{.Id}}' "$image")
    fi
    [[ "$image_id" == "$expected_image" ]] || {
        printf 'Docker image %s differs from the prepared compiler cache.\n' "$image" >&2
        return 1
    }
}

save_image() {
    local platform=$1 ref=$2 archive
    verify_cache "$platform" "$ref"
    archive="$cache_root/$platform/$ref.image.tar.zst"
    if [[ ! -e "$archive" ]]; then
        local work
        work=$(mktemp -d "$cache_root/$platform/.image.XXXXXXXX")
        cleanup+=("$work")
        docker save "exact-boat-$platform:$ref" | zstd -q -T4 -1 -o "$work/image.tar.zst"
        mv -T -- "$work/image.tar.zst" "$archive"
    fi
    printf 'Saved %s\n' "$archive"
}

export_cache() {
    local platform=$1 ref=$2 output work
    verify_cache "$platform" "$ref"
    output=$(realpath -m "$3")
    [[ ! -e "$output" && -d "$(dirname "$output")" ]]
    work=$(mktemp -d "$(dirname "$output")/.exact-export.XXXXXXXX")
    cleanup+=("$work")
    docker save -o "$work/image.tar" "exact-boat-$platform:$ref"
    printf '2 %s %s\n' "$platform" "$ref" > "$work/cache.txt"
    # SwiftPM checks fractional mtimes on compiled targets and their inputs.
    tar --format=pax --pax-option=delete=atime,delete=ctime -cf - \
        -C "$work" cache.txt image.tar -C "$cache_root" "$platform/$ref" |
        zstd -q -T4 -1 -o "$work/cache.tar.zst"
    mv -T "$work/cache.tar.zst" "$output"
    printf 'Exported %s\n' "$output"
}

restore_cache() {
    local archive=$1 work format platform ref image_id cache_lock
    mkdir -p "$cache_root"
    work=$(mktemp -d "$cache_root/.restore.XXXXXXXX")
    cleanup+=("$work")
    # The archive is produced on a trusted runner by export_cache.
    tar --zstd --no-same-owner --exclude=image.tar -xf "$archive" -C "$work"
    read -r format platform ref < "$work/cache.txt"
    [[ "$format" == 2 ]] || { echo 'Regenerate this cache archive with the current export command.' >&2; exit 1; }
    [[ $platform == ios || $platform == android ]]
    mkdir -p "$cache_root/$platform"
    exec {cache_lock}< "$cache_root/$platform"
    flock -x "$cache_lock"
    [[ $ref =~ ^[0-9a-f]{40}$ && ! -e "$cache_root/$platform/$ref" ]]
    jq -e --arg ref "$ref" '.format == 1 and .exactRef == $ref' "$work/$platform/$ref/manifest.json" >/dev/null
    tar --zstd -xOf "$archive" image.tar | docker load
    image_id=$(docker image inspect --format '{{.Id}}' "exact-boat-$platform:$ref")
    jq -e --arg id "$image_id" '.imageId == $id' "$work/$platform/$ref/manifest.json" >/dev/null
    mv -T "$work/$platform/$ref" "$cache_root/$platform/$ref"
    verify_cache "$platform" "$ref"
    printf 'Restored %s %s\n' "$platform" "$ref"
}

[[ $(uname -sm) == 'Linux x86_64' ]] || { echo 'Use an x86-64 Linux runner with Docker.' >&2; exit 2; }
# Boat invokes --setup-file without arguments.
if [[ $# == 0 && -n ${EXACT_MOBILE_SETUP_PLATFORM:-} ]]; then
    set -- prepare "$EXACT_MOBILE_SETUP_PLATFORM"
fi
case "${1:-}" in
    prepare) [[ $# == 2 && ( $2 == ios || $2 == android ) ]] || usage; prepare "$2" ;;
    ios|android) [[ $# == 4 ]] || usage; build_mobile "$@" ;;
    save-image|load-image)
        [[ $# == 3 && ( $2 == ios || $2 == android ) ]] || usage
        if [[ "$1" == save-image ]]; then save_image "$2" "$3"; else verify_cache "$2" "$3"; fi
        ;;
    _build) [[ $# == 2 && ( $2 == ios || $2 == android ) ]] || usage; execute_build "$2" ;;
    _android-sdk) [[ $# == 1 ]] || usage; setup_android_sdk ;;
    export) [[ $# == 4 && ( $2 == ios || $2 == android ) ]] || usage; shift; export_cache "$@" ;;
    restore) [[ $# == 2 ]] || usage; restore_cache "$2" ;;
    _seed)
        [[ $# == 5 && ( $2 == ios || $2 == android ) ]] || usage
        platform=$2
        shift 2
        "seed_$platform" "$@"
        ;;
    *) usage ;;
esac
