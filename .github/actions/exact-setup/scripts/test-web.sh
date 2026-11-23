#!/usr/bin/env bash
set -euo pipefail

if chrome=$(command -v google-chrome); then
  export CHROME="$chrome"
else
  bunx playwright@1.65.1 install --with-deps chromium-headless-shell
fi
exec bun exact.mjs test web
