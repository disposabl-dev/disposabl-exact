#!/usr/bin/env bash
set -euo pipefail

package=${1:?Select cli or sdk}
output=${2:?Set an absolute output directory}
cd "$(dirname "${BASH_SOURCE[0]}")/../../packages/$package"

case "$package" in
  cli)
    node --check index.mjs
    bin=$(node -p 'Object.keys(require("./package.json").bin)[0]')
    ;;
  sdk)
    if [[ -z "${DISPOSABL_API_ORIGIN:-}" && -f ../backend/.env.local ]]; then
      DISPOSABL_API_ORIGIN=$(bun --env-file=../backend/.env.local -p 'process.env.CONVEX_SITE_URL ?? ""')
      export DISPOSABL_API_ORIGIN
    fi
    bun run build
    ;;
  *) exit 1 ;;
esac

mkdir -p "$output"
npm pack --pack-destination "$output" --ignore-scripts --json > "$output/package.json"
tarball=$(node -p 'require(process.argv[1])[0].filename' "$output/package.json")
mv "$output/$tarball" "$output/client.tgz"
scratch=$(mktemp -d)
trap 'rm -r "$scratch"' EXIT
cd "$scratch"
npm install --ignore-scripts --no-audit --no-fund "$output/client.tgz"
if [[ "$package" == cli ]]; then
  "./node_modules/.bin/$bin" --help
else
  name=$(node -p 'require(process.argv[1])[0].name' "$output/package.json")
  node --input-type=module -e 'if (typeof (await import(process.argv[1])).createClient !== "function") process.exit(1)' "$name"
fi
