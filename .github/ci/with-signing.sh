#!/usr/bin/env bash
# Expose one signing value to the command that needs it.
set -euo pipefail
name=${1:?Expected a signing variable name}
shift
case "$name" in EXACT_UPDATE_SEED|ANDROID_APK_SIGNING) ;; *) exit 2 ;; esac

: "${CONVEX_DEPLOY_KEY:?Set the production Convex deploy key}"
value=$(cd "${GITHUB_WORKSPACE:?}/packages/backend" && bun run --silent convex env get "$name")
: "${value:?Missing $name in the production Convex environment}"
if [[ "${GITHUB_ACTIONS:-}" == true ]]; then
  masked=${value//%/%25}
  masked=${masked//$'\r'/%0D}
  masked=${masked//$'\n'/%0A}
  printf '::add-mask::%s\n' "$masked"
fi

unset CONVEX_DEPLOY_KEY
export "$name=$value"
exec "$@"
