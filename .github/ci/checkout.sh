#!/usr/bin/env bash
# Check out Exact at the published SHA and apply a narrow upstream compatibility fix.
set -euo pipefail
ref=${1:?Expected a full Exact SHA}
exact=${2:?Expected a checkout path}
mode=${3:-}
[[ -z "$mode" || "$mode" == keep-tools ]] || { echo "Unknown checkout mode: $mode" >&2; exit 2; }
[[ "$ref" =~ ^[0-9a-f]{40}$ ]]
mkdir -p "$(dirname "$exact")"
if [[ -e "$exact" ]]; then
  [[ -d "$exact/.git" && $(git -C "$exact" rev-parse HEAD) == "$ref" ]] || { echo "Unexpected Exact checkout: $exact" >&2; exit 1; }
else
  git init -q "$exact"
  git -C "$exact" fetch -q --depth=1 https://github.com/expo/exact.git "$ref"
  git -C "$exact" checkout -q --detach FETCH_HEAD
fi
file="$exact/host/web-js/build.mjs"
if [[ -f "$file" && $(git hash-object "$file") == 95ce1d40a36a06d99df56b29345b8de100be5229 ]]; then
  python3 - "$file" <<'PY'
import pathlib, sys
path = pathlib.Path(sys.argv[1])
source = path.read_text()
old = "'isCloudMetadata', 'isLocalNetwork'"
new = "'isCloudMetadata', 'isLocalNetwork', 'isLoopback'"
assert source.count(old) == 1
assert source.count("export { isCloudMetadata, isLocalNetwork }") == 1
source = source.replace(old, new)
source = source.replace("export { isCloudMetadata, isLocalNetwork }", "export { isCloudMetadata, isLocalNetwork, isLoopback }")
path.write_text(source)
PY
fi

# `tools keep` accepts only committed inputs. The web cache producer opts into
# a temporary local commit; it resets HEAD to $ref after keep without changing
# the patched bytes. Ordinary consumers always retain the upstream HEAD.
if [[ "$mode" == keep-tools ]] && ! git -C "$exact" diff --quiet -- host/web-js/build.mjs; then
  [[ $(git -C "$exact" rev-parse HEAD:host/web-js/build.mjs) == 95ce1d40a36a06d99df56b29345b8de100be5229 && $(git hash-object "$file") == 64a1ead2e05dbdecc3c13144512c31bd57dd7a23 ]] || { echo 'Unexpected compatibility patch' >&2; exit 1; }
  [[ $(git -C "$exact" status --porcelain) == ' M host/web-js/build.mjs' ]] || { echo 'Unexpected changes in Exact checkout' >&2; exit 1; }
  git -C "$exact" add -- host/web-js/build.mjs
  GIT_AUTHOR_NAME='Exact CI' GIT_AUTHOR_EMAIL='ci@invalid' GIT_COMMITTER_NAME='Exact CI' GIT_COMMITTER_EMAIL='ci@invalid' \
    GIT_AUTHOR_DATE=2000-01-01T00:00:00Z GIT_COMMITTER_DATE=2000-01-01T00:00:00Z \
    git -C "$exact" -c commit.gpgsign=false -c core.hooksPath=/dev/null \
      commit --quiet -m 'Apply web compatibility fix for tool production'
fi
