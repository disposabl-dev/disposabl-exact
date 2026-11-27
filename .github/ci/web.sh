#!/usr/bin/env bash
set -euo pipefail
root=$(cd "$(dirname "$0")/../.." && pwd)
cd "$root"
: "${WEB:?Set WEB to true or false}"
[[ "$WEB" == true || "$WEB" == false ]] || { echo 'Invalid WEB value' >&2; exit 1; }

if [[ "$WEB" == true ]]; then
  : "${EXACT:?Run setup.sh web first}"
  mkdir -p apps/apps/.exact
  ln -sfn "$EXACT" apps/apps/.exact/checkout
  (cd apps/apps && bun install --frozen-lockfile)
fi

if [[ "${PREVIEW_BUILD_ONLY:-false}" == true ]]; then
  [[ -n "${PR_NUMBER:-}" ]] || { echo 'Build-only mode requires a PR' >&2; exit 1; }
  if [[ "$WEB" == true ]]; then
    (cd apps/apps && env -u CONVEX_DEPLOY_KEY CONVEX_ORIGIN=wss://example.convex.cloud CONVEX_SITE_ORIGIN=https://example.convex.site bun exact.mjs web-build --out dist/convex)
  fi
  exit 0
fi

: "${CONVEX_DEPLOY_KEY:?Set a Convex deploy key}"
cd "$root/packages/backend"
bun install --frozen-lockfile
bun run generate:platforms

if [[ -n "${PR_NUMBER:-}" ]]; then
  [[ "$PR_NUMBER" =~ ^[0-9]+$ && "$CONVEX_DEPLOY_KEY" == preview:*:*\|* ]] || { echo 'A numeric PR number and preview deploy key are required' >&2; exit 1; }
  # Match the claim_preview_deployment request used by the installed Convex CLI.
  # Keep the returned key in a private file, never in command output.
  credentials=$(mktemp "${RUNNER_TEMP:-/tmp}/convex-preview.XXXXXXXX")
  trap 'rm -f "$credentials"' EXIT
  chmod 600 "$credentials"
  bun -e '
    const key = process.env.CONVEX_DEPLOY_KEY;
    const [kind, teamSlug, projectSlug] = key.split("|")[0].split(":");
    if (kind !== "preview" || !teamSlug || !projectSlug) throw Error("Invalid preview deploy key");
    const response = await fetch("https://api.convex.dev/api/claim_preview_deployment", {
      method: "POST", headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ projectSelection: { kind: "teamAndProjectSlugs", teamSlug, projectSlug }, identifier: `pr-${process.env.PR_NUMBER}`, reuse: true }),
    });
    if (!response.ok) throw Error(`Preview claim failed: HTTP ${response.status}`);
    const data = await response.json();
    if (typeof data.adminKey !== "string" || !data.adminKey.includes("|") || !/^https:\/\/[a-zA-Z0-9.-]+$/.test(data.instanceUrl)) throw Error("Invalid preview credentials");
    await Bun.write(process.argv[1], JSON.stringify({ key: data.adminKey, url: data.instanceUrl }));
  ' "$credentials"
  CONVEX_DEPLOY_KEY=$(bun -e 'console.log(JSON.parse(await Bun.file(process.argv[1]).text()).key)' "$credentials")
  export CONVEX_DEPLOY_KEY
  [[ -z "${GITHUB_ACTIONS:-}" ]] || printf '::add-mask::%s\n' "$CONVEX_DEPLOY_KEY"
fi

url=$(bun run convex env get CONVEX_CLOUD_URL --prod)
site=$(bun run convex env get CONVEX_SITE_URL --prod)
[[ "$url" =~ ^https://[a-zA-Z0-9.-]+$ && "$site" =~ ^https://[a-zA-Z0-9.-]+$ ]] || { echo 'Invalid Convex origins' >&2; exit 1; }
if [[ -n "${PR_NUMBER:-}" ]]; then
  claimed=$(bun -e 'console.log(JSON.parse(await Bun.file(process.argv[1]).text()).url)' "$credentials")
  [[ "$url" == "$claimed" ]] || { echo 'Preview target mismatch' >&2; exit 1; }
fi
origin="wss://${url#https://}"
export CONVEX_SITE_ORIGIN="$site" EXPECTED_ORIGIN="$origin"

if [[ "$WEB" == true ]]; then
  build='test "wss://${VITE_CONVEX_URL#https://}" = "$EXPECTED_ORIGIN" && cd ../../apps/apps && rm -rf dist/convex && env -u CONVEX_DEPLOY_KEY CONVEX_ORIGIN="$EXPECTED_ORIGIN" CONVEX_SITE_ORIGIN="$CONVEX_SITE_ORIGIN" bun exact.mjs web-build --out dist/convex && rm -f dist/convex/.exact-build.json'
  bun run static-hosting deploy --dist ../../apps/apps/dist/convex --build-command "$build"
else
  bun run convex deploy --yes
fi

if [[ -n "${GITHUB_OUTPUT:-}" ]]; then
  printf 'convex_origin=%s\nconvex_site_origin=%s\n' "$origin" "$site" >> "$GITHUB_OUTPUT"
fi
if [[ -n "${GITHUB_STEP_SUMMARY:-}" ]]; then printf 'Convex site: %s\n' "$site" >> "$GITHUB_STEP_SUMMARY"; fi
