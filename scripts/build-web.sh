#!/usr/bin/env bash
# Run from an isolated build checkout. The native update manifest requires web.base = /.
set -euo pipefail
if [[ ${EXACT_PAGES_BUILD:-false} == true ]]; then
  saved=$(mktemp)
  cp -p app.json "$saved"
  trap 'mv "$saved" app.json' EXIT
  bun -e '
    const app = require("./app.json");
    app.host.web.base = new URL(app.deploy.channels.prod).pathname;
    await Bun.write("app.json", JSON.stringify(app, null, 2) + "\n");
  '
fi
bun exact.mjs web-build --out dist --json
