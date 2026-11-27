#!/usr/bin/env bash
# Check out Exact at the published SHA and apply a narrow upstream compatibility fix.
set -euo pipefail
ref=${1:?Expected a full Exact SHA}
exact=${2:?Expected a checkout path}
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
