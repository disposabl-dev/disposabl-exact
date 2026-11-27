#!/usr/bin/env bash
# Provision update signing, and optionally the APK key, in the deployment environment.
set -euo pipefail
repo=$(gh repo view --json nameWithOwner --jq .nameWithOwner)
env_name=android-production
dir=$(mktemp -d)
trap 'rm -rf "$dir"' EXIT
if ! gh api "repos/$repo/environments/$env_name" >/dev/null 2>"$dir/error"; then
  grep -q 'HTTP 404' "$dir/error" || { cat "$dir/error" >&2; exit 1; }
  gh api --method PUT "repos/$repo/environments/$env_name" >/dev/null
fi
names=$(gh secret list --repo "$repo" --env "$env_name" --json name --jq '.[].name')
if grep -Fxq EXACT_UPDATE_SEED <<< "$names"; then
  echo 'Using the existing update key.'
else
  openssl rand -base64 32 | gh secret set EXACT_UPDATE_SEED --repo "$repo" --env "$env_name"
fi
[[ ${1:-android} == android ]] || exit 0
if grep -Fxq ANDROID_APK_SIGNING <<< "$names"; then echo 'Using the existing APK key.'; exit 0; fi
export KEYSTORE_PASSWORD=$(openssl rand -hex 32)
keytool -genkeypair -noprompt -storetype PKCS12 -keystore "$dir/android.p12" -alias android \
  -keyalg RSA -keysize 2048 -validity 10000 -dname 'CN=Android preview' -storepass:env KEYSTORE_PASSWORD
openssl base64 -A -in "$dir/android.p12" -out "$dir/encoded"
jq -nc --rawfile keystore "$dir/encoded" '{keystore:$keystore,password:env.KEYSTORE_PASSWORD}' |
  gh secret set ANDROID_APK_SIGNING --repo "$repo" --env "$env_name"
