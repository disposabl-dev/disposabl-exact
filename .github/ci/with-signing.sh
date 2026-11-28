#!/usr/bin/env bash
# Expose one signing value to the command that needs it.
set -euo pipefail
name=${1:?Expected a signing variable name}
shift
case "$name" in EXACT_UPDATE_SEED|ANDROID_APK_SIGNING) ;; *) exit 2 ;; esac

# Older apps already have published builds signed with their GitHub secrets.
if [[ -z "${!name:-}" ]]; then
  : "${CONVEX_DEPLOY_KEY:?Set the production Convex deploy key}"
  value=$(cd "${GITHUB_WORKSPACE:?}/packages/backend" && bun run --silent convex env get "$name")
  : "${value:?Missing $name in the production Convex environment}"
  if [[ "${GITHUB_ACTIONS:-}" == true ]]; then
    masked=${value//%/%25}
    masked=${masked//$'\r'/%0D}
    masked=${masked//$'\n'/%0A}
    printf '::add-mask::%s\n' "$masked"
  fi
  export "$name=$value"
fi

unset CONVEX_DEPLOY_KEY
exec "$@"
