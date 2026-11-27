#!/usr/bin/env bash
set -euo pipefail
root=${GITHUB_WORKSPACE:-$(cd "$(dirname "$0")/../.." && pwd)}
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
  [[ "${PR_NUMBER:-}" =~ ^[0-9]+$ ]] || { echo 'Build-only mode requires a PR' >&2; exit 1; }
  url=https://example.convex.cloud site=https://example.convex.site
else
  : "${CONVEX_DEPLOY_KEY:?Set a Convex deploy key}"
  cd "$root/packages/backend"
  bun install --frozen-lockfile
  bun run generate:platforms
  upload_mode=--prod
  if [[ -n "${PR_NUMBER:-}" ]]; then
    [[ "$PR_NUMBER" =~ ^[0-9]+$ && "$CONVEX_DEPLOY_KEY" == preview:*:*\|* ]] || { echo 'A numeric PR and preview deploy key are required' >&2; exit 1; }
    # Same claim request as the installed Convex CLI. Never print the response.
    credentials=$(mktemp "${RUNNER_TEMP:-/tmp}/convex-preview.XXXXXXXX")
    trap 'rm -f "$credentials"' EXIT
    chmod 600 "$credentials"
    bun -e '
      const key = process.env.CONVEX_DEPLOY_KEY, [kind, teamSlug, projectSlug] = key.split("|")[0].split(":");
      if (kind !== "preview" || !teamSlug || !projectSlug) throw Error("Invalid preview key");
      const res = await fetch("https://api.convex.dev/api/claim_preview_deployment", { method: "POST", headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" }, body: JSON.stringify({ projectSelection: { kind: "teamAndProjectSlugs", teamSlug, projectSlug }, identifier: `pr-${process.env.PR_NUMBER}`, reuse: true }) });
      if (!res.ok) throw Error(`Preview claim failed: HTTP ${res.status}`);
      const { adminKey, instanceUrl } = await res.json();
      if (typeof adminKey !== "string" || !adminKey.includes("|") || !/^https:\/\/[a-zA-Z0-9.-]+$/.test(instanceUrl)) throw Error("Invalid preview credentials");
      await Bun.write(process.argv[1], JSON.stringify({ adminKey, instanceUrl }));
    ' "$credentials"
    export CONVEX_SELF_HOSTED_URL=$(bun -e 'console.log(JSON.parse(await Bun.file(process.argv[1]).text()).instanceUrl)' "$credentials")
    export CONVEX_SELF_HOSTED_ADMIN_KEY=$(bun -e 'console.log(JSON.parse(await Bun.file(process.argv[1]).text()).adminKey)' "$credentials")
    [[ -z "${GITHUB_ACTIONS:-}" ]] || printf '::add-mask::%s\n' "$CONVEX_SELF_HOSTED_ADMIN_KEY"
    unset CONVEX_DEPLOY_KEY CONVEX_DEPLOYMENT
    upload_mode=--no-prod
  fi
  bun run convex deploy --yes
  url=$(bun run convex env get CONVEX_CLOUD_URL)
  site=$(bun run convex env get CONVEX_SITE_URL)
  [[ -z "${PR_NUMBER:-}" || "$url" == "$CONVEX_SELF_HOSTED_URL" ]] || { echo 'Preview target mismatch' >&2; exit 1; }
fi
[[ "$url" =~ ^https://[a-zA-Z0-9.-]+$ && "$site" =~ ^https://[a-zA-Z0-9.-]+$ ]] || { echo 'Invalid Convex origins' >&2; exit 1; }
origin="wss://${url#https://}"
if [[ "$WEB" == true ]]; then
  (cd "$root/apps/apps" && rm -rf dist/convex && env -u CONVEX_DEPLOY_KEY -u CONVEX_SELF_HOSTED_ADMIN_KEY -u CONVEX_SELF_HOSTED_URL -u CONVEX_DEPLOYMENT CONVEX_ORIGIN="$origin" CONVEX_SITE_ORIGIN="$site" bun --no-env-file exact.mjs web-build --out dist/convex && rm -f dist/convex/.exact-build.json)
  if [[ "${PREVIEW_BUILD_ONLY:-false}" != true ]]; then bun run static-hosting upload --dist ../../apps/apps/dist/convex "$upload_mode"; fi
fi
if [[ "${PREVIEW_BUILD_ONLY:-false}" != true ]]; then
  [[ -z "${GITHUB_OUTPUT:-}" ]] || printf 'convex_origin=%s\nconvex_site_origin=%s\n' "$origin" "$site" >> "$GITHUB_OUTPUT"
  [[ -z "${GITHUB_STEP_SUMMARY:-}" ]] || printf 'Convex site: %s\n' "$site" >> "$GITHUB_STEP_SUMMARY"
fi
