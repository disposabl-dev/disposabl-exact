#!/usr/bin/env bash
set -euo pipefail
if [[ "${1:-}" == build ]]; then
  set -- "$@" -Xswiftc -explicit-module-build -Xswiftc -cache-compile-job \
    -Xswiftc -cas-path -Xswiftc "$CARGO_TARGET_DIR/swift-cas" -Xswiftc -Rcache-compile-job
fi
exec "$IOS_REAL_SWIFT" "$@"
