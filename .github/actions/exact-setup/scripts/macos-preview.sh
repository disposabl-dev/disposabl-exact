#!/usr/bin/env bash
set -euo pipefail

export EXACT_IDENTITY=-
out="$RUNNER_TEMP/macos-preview"
mkdir -p "$out"
if [[ "$RUNNER_OS" == Linux ]]; then
  tools=$(mktemp -d "$RUNNER_TEMP/exact-apple-commands.XXXXXX")
  cat > "$tools/xcrun" <<'XCRUN'
#!/usr/bin/env bash
exec bun "$EXACT/host/apple/toolchain.mjs" "$@"
XCRUN
  chmod +x "$tools/xcrun"
  export PATH="$tools:$PATH"
fi

bun exact.mjs mac --release --json > "$out/build.json"
bundle=$(jq -er '.path | select(endswith(".app"))' "$out/build.json")
binary=$(python3 - "$bundle" "$(jq -er '.app.id' app.json)" <<'PY'
from pathlib import Path
import plistlib
import sys

contents = Path(sys.argv[1]) / "Contents"
with (contents / "Info.plist").open("rb") as file:
    info = plistlib.load(file)
executable = info["CFBundleExecutable"]
assert info["CFBundleIdentifier"] == sys.argv[2]
assert Path(executable).name == executable and executable not in ("", ".", "..")
print(contents / "MacOS" / executable)
PY
)
if [[ "$RUNNER_OS" == Linux ]]; then
  llvm-lipo "$binary" -verify_arch arm64
  llvm-objdump --macho --private-headers "$binary" > "$out/platform.txt"
  rcodesign print-signature-info --config-file /dev/null "$binary" > "$out/signature.txt"
  grep -q 'CodeSignatureFlags(.*ADHOC' "$out/signature.txt"
  grep -Eq '^[[:space:]]*cms: null[[:space:]]*$' "$out/signature.txt"
else
  xcrun lipo -verify_arch arm64 "$binary"
  xcrun vtool -show-build "$binary" > "$out/platform.txt"
  codesign --verify --deep --strict "$bundle"
fi
grep -Eiq '^[[:space:]]*platform[[:space:]]+(macos|1)[[:space:]]*$' "$out/platform.txt"
(cd "$(dirname "$bundle")" && zip -q -r -y "$out/app.zip" "$(basename "$bundle")")
unzip -tq "$out/app.zip"
echo 'Verified the Apple Silicon macOS preview ZIP.'
