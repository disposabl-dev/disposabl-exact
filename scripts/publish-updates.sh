#!/usr/bin/env bash
set -euo pipefail
site="$GITHUB_WORKSPACE/published"
source_sha=$(git -C "$APP_DIR" rev-parse HEAD)
cd "$APP_DIR"
key_id=$(bun -e 'const id=require("./app.json").deploy?.signing?.key; if (!/^[A-Za-z0-9_-]+$/.test(id ?? "")) throw Error("Configure an OTA signing key first"); console.log(id)')
scratch=$(mktemp -d)
trap 'rm -rf "$scratch"' EXIT
(umask 077 && printf '%s\n' "${EXACT_OTA_SIGNING_KEY:?Set the OTA key for this repository}" > "$scratch/$key_id.pem")
unset EXACT_OTA_SIGNING_KEY
mkdir -p "$site/downloads"
bases="$site/downloads/bases.json"
[[ -f "$bases" ]] || echo '{}' > "$bases"

if [[ -n "${BASE_SHA:-}" ]]; then
  [[ "$BASE_SHA" =~ ^[[:xdigit:]]{40}$ ]]
  git -C "$GITHUB_WORKSPACE" merge-base --is-ancestor "$BASE_SHA" "$source_sha"
  base_platforms=(android ios)
  tag="build-$BASE_SHA"
  if [[ -n "${REPAIR_PLATFORM:-}" ]]; then
    [[ "$REPAIR_PLATFORM" == android || "$REPAIR_PLATFORM" == ios ]]
    [[ "$REPAIR_TAG" =~ ^repair-${BASE_SHA}-${REPAIR_PLATFORM}-[0-9]+$ ]]
    tag="$REPAIR_TAG"
    base_platforms=("$REPAIR_PLATFORM")
  fi
  for platform in "${base_platforms[@]}"; do
    receipts="$scratch/receipts/$platform"
    mkdir -p "$receipts"
    gh release download "$tag" -R "$GITHUB_REPOSITORY" -p "$platform.build.json" -D "$receipts"
    id=$(jq -er --arg platform "$platform" --arg app "$(jq -r .app.id app.json)" '
      select(.trust == "production" and .compat.inputs.app == $app and .compat.inputs.platform == $platform and .compat.inputs.store.L == "A")
      | .compat.id | select(test("^[0-9a-f]{32}$"))' "$receipts/$platform.build.json")
    if [[ ! -e "$site/.exact/prod/$id" ]]; then
      origin="$scratch/origin/$platform"
      mkdir -p "$origin"
      EXACT_BAKE_OUTPUT="$receipts" EXACT_UPDATE_TRUST=production bun exact.mjs push --keys "$scratch" --origin "$origin"
      test -s "$origin/.exact/prod/$id/exact.json"
      rsync -a --ignore-existing "$origin/" "$site/"
    fi
    jq --arg platform "$platform" --arg id "$id" --arg tag "$tag" '.[$platform]={compatibilityId:$id,tag:$tag}' "$bases" > "$scratch/bases.json"
    cp "$scratch/bases.json" "$bases"
  done
fi

known=()
for platform in android ios; do
  if jq -e --arg p "$platform" '.[$p].compatibilityId' "$bases" >/dev/null; then
    known+=(--platform "$platform")
  fi
done
if (( ${#known[@]} )); then
  # Keep Cargo's frozen source snapshot and build directory stable between edits.
  export CARGO_TARGET_DIR="${EXACT_CLASSIFIER_CACHE:-$HOME/exact-update-work/classifier}"
  mkdir -p "$CARGO_TARGET_DIR"
  export EXACT_ROOT="$EXACT"
  args=("$EXACT/scripts/deploy.mjs" "$CLASSIFIER_APP" --dirty --only bundle "${known[@]}" --origin "$site" --keys "$scratch" --json)
  bun "${args[@]}" > "$scratch/plan.json"
  if [[ -n "${BASE_SHA:-}" ]]; then
    # A baseline is valid only for identical app inputs. The demo's first base
    # predated moving the web-only Pages prefix to the web packaging step.
    changed=$(git -C "$GITHUB_WORKSPACE" diff --name-only "$BASE_SHA" "$source_sha" -- apps/apps)
    equivalent=false
    if [[ -z "$changed" ]]; then equivalent=true
    elif [[ "$changed" == apps/apps/app.json ]]; then
      if diff -q <(git -C "$GITHUB_WORKSPACE" show "$BASE_SHA:apps/apps/app.json" | jq -Sc 'del(.host.web.base)') <(jq -Sc 'del(.host.web.base)' app.json) >/dev/null; then equivalent=true; fi
    fi
    if [[ "$equivalent" == true ]]; then
      for platform in "${base_platforms[@]}"; do
        jq --arg p "$platform" --arg sha "$source_sha" --slurpfile plan "$scratch/plan.json" '
          .[$p].compatibilityId as $id | .[$p].sourceSha=$sha |
          .[$p].baselinePendingInputs=[$plan[0].rows[] | select(.kind=="binary" and .platform==$p and .compatibilityId==$id) | .pendingInputs[]?]' "$bases" > "$scratch/bases.json"
        cp "$scratch/bases.json" "$bases"
      done
    fi
  fi
  bun "$GITHUB_WORKSPACE/scripts/route-updates.mjs" "$scratch/plan.json" "$bases" "$site" app.json "$source_sha" > "$scratch/routes.json"
  if jq -e '.rows[] | select(.kind=="stream" and .action=="bundle")' "$scratch/plan.json" >/dev/null; then
    snapshot=$(jq -er '.snapshot.id' "$scratch/plan.json")
    bun "${args[@]}" --snapshot "$snapshot" --yes > "$scratch/result.json"
    jq -e '.failed == []' "$scratch/result.json" >/dev/null
  fi
  unset CARGO_TARGET_DIR
else
  echo '{"android":{"action":"native"},"ios":{"action":"native"}}' > "$scratch/routes.json"
fi
cat "$scratch/routes.json"
EXACT_PAGES_BUILD=true bash "$GITHUB_WORKSPACE/scripts/build-web.sh"
rsync -a --exclude='/.exact-build.json' dist/ "$site/"
(cd dist && zip -qr "$scratch/web.zip" .)
tag="update-$source_sha"
gh release view "$tag" -R "$GITHUB_REPOSITORY" >/dev/null 2>&1 ||
  gh release create "$tag" -R "$GITHUB_REPOSITORY" --target "$source_sha" --title "Update ${source_sha:0:8}" --notes "Web download and signed mobile update" --prerelease
gh release upload "$tag" "$scratch/web.zip" --clobber -R "$GITHUB_REPOSITORY"
download="https://github.com/$GITHUB_REPOSITORY/releases/download"
{
  echo '<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Downloads</title><main><h1>Downloads</h1><ul>'
  echo "<li><a href=\"$download/$tag/web.zip\">Web ZIP</a></li>"
  for platform in android ios; do
    base=$(jq -r --arg p "$platform" '.[$p].tag // empty' "$bases")
    [[ -n "$base" ]] || continue
    if [[ "$platform" == ios ]]; then asset=ios-unsigned.ipa; label='Unsigned iOS IPA'; else asset=android.apk; label='Android APK'; fi
    echo "<li><a href=\"$download/$base/$asset\">$label</a></li>"
  done
  echo '</ul><p>Mobile downloads contain the base app and receive compatible updates after installation.</p></main></html>'
} > "$site/downloads/index.html"
touch "$site/.nojekyll"
git -C "$site" config user.name github-actions
git -C "$site" config user.email '41898282+github-actions[bot]@users.noreply.github.com'
git -C "$site" add -A
if ! git -C "$site" diff --cached --quiet; then
  git -C "$site" commit -qm "Publish $source_sha"
  git -C "$site" push origin HEAD:gh-pages
fi
gh api -X POST "repos/$GITHUB_REPOSITORY/pages/builds" --silent
for platform in android ios; do
  if [[ "$(jq -r --arg p "$platform" '.[$p].action' "$scratch/routes.json")" == native ]]; then
    gh workflow run native-repair.yml -R "$GITHUB_REPOSITORY" --ref main -f sha="$source_sha" -f platform="$platform"
  fi
done
