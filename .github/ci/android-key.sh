#!/usr/bin/env bash
# Run once from the app repository with GitHub CLI and a JDK.
set -euo pipefail
repo=$(gh repo view --json nameWithOwner --jq .nameWithOwner)
env_name=android-production
gh api --method PUT "repos/$repo/environments/$env_name" >/dev/null
names=$(gh secret list --repo "$repo" --env "$env_name" --json name --jq '.[].name')
if grep -Fxq ANDROID_APK_SIGNING <<< "$names"; then echo 'Using the existing APK key.'; exit 0; fi
dir=$(mktemp -d)
trap 'rm -rf "$dir"' EXIT
export KEYSTORE_PASSWORD=$(openssl rand -hex 32)
keytool -genkeypair -noprompt -storetype PKCS12 -keystore "$dir/android.p12" -alias android \
  -keyalg RSA -keysize 2048 -validity 10000 -dname 'CN=Android preview' -storepass:env KEYSTORE_PASSWORD
jq -nc --arg keystore "$(openssl base64 -A -in "$dir/android.p12")" \
  '{keystore:$keystore,password:env.KEYSTORE_PASSWORD}' | gh secret set ANDROID_APK_SIGNING --repo "$repo" --env "$env_name"
