#!/usr/bin/env bash
set -euo pipefail

directory=${1:?Provide the packed client directory}
tarball="$directory/client.tgz"
policy=${2:-verify}
metadata="$directory/package.json"
name=$(node -p 'require(process.argv[1])[0].name' "$metadata")
version=$(node -p 'require(process.argv[1])[0].version' "$metadata")
integrity=$(node -p 'require(process.argv[1])[0].integrity' "$metadata")
target="$name@$version"
node -e '
  const { createHash } = require("node:crypto");
  const { readFileSync } = require("node:fs");
  const actual = createHash("sha512").update(readFileSync(process.argv[1])).digest("base64");
  if ("sha512-" + actual !== process.argv[2]) throw Error("Packed tarball integrity mismatch");
' "$tarball" "$integrity"
npm_lookup() {
  npm view "$1" "$2" --registry=https://registry.npmjs.org --prefer-online --fetch-retries=0 --fetch-timeout=5000
}
echo "Checking $target"
if published=$(npm_lookup "$target" dist.integrity 2>"$RUNNER_TEMP/npm-lookup.log") && [[ -n "$published" ]]; then
  if [[ "$published" == "$integrity" ]]; then
    echo "$target is already on npm with matching integrity."
    exit 0
  fi
  if [[ "$policy" == skip-existing ]]; then
    echo "::notice::$target already exists. Bump the package version to publish a new build."
    exit 0
  fi
  echo "$target already exists with different contents. Choose a new version."
  exit 1
elif [[ -s "$RUNNER_TEMP/npm-lookup.log" ]] && ! grep -q 'E404' "$RUNNER_TEMP/npm-lookup.log"; then
  cat "$RUNNER_TEMP/npm-lookup.log" >&2
  exit 1
fi
if latest=$(npm_lookup "$name@latest" version 2>"$RUNNER_TEMP/npm-lookup.log") && [[ -n "$latest" ]]; then
  node -e '
    const [version, latest] = process.argv.slice(1);
    if (!/^\d+\.\d+\.\d+$/.test(version) || !/^\d+\.\d+\.\d+$/.test(latest)) throw Error("Expected stable versions");
    const nextParts = version.split(".").map(Number);
    const currentParts = latest.split(".").map(Number);
    const difference = nextParts.findIndex((part, index) => part !== currentParts[index]);
    if (difference < 0 || nextParts[difference] < currentParts[difference]) {
      throw Error(`${version} must be newer than npm latest ${latest}`);
    }
  ' "$version" "$latest"
elif [[ -s "$RUNNER_TEMP/npm-lookup.log" ]] && ! grep -q 'E404' "$RUNNER_TEMP/npm-lookup.log"; then
  cat "$RUNNER_TEMP/npm-lookup.log" >&2
  exit 1
fi

npm publish "$tarball" --registry=https://registry.npmjs.org --tag latest --access public --provenance
for attempt in {1..36}; do
  if published=$(npm_lookup "$target" dist.integrity) && [[ "$published" == "$integrity" ]]; then
    echo "Verified $target on npm."
    exit 0
  fi
  sleep 10
done
echo "npm has not confirmed the integrity of $target." >&2
exit 1
