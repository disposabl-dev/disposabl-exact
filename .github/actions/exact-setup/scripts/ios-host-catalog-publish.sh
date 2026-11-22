#!/usr/bin/env bash
# Build SDK-owned Swift targets only, for the pinned public 17.0 iOS toolchain.
set -euo pipefail
: "${EXACT:?}" "${EXACT_REF:?}" "${CARGO_TARGET_DIR:?}" "${RUNNER_TEMP:?}"
[[ "$EXACT_REF" == a55c5581c7e1a62cdee1f09367ea2909c74c7292 && $(git -C "$EXACT" rev-parse HEAD) == "$EXACT_REF" ]]
scripts=$(cd "$(dirname "$0")" && pwd)
kit="$HOME/.cache/exact/ios-link-kit/$EXACT_REF"
scratch="$CARGO_TARGET_DIR/apple-swift/ios-17.0-balanced"
product="$scratch/out/Products/Release-iphoneos"
sdk=$(xcrun --sdk iphoneos --show-sdk-path)
cd "$EXACT/host/apple"
export EXACT_APP_COMPOSITION=updating EXACT_APPLE_LINK=markdown,io,modules,native_views EXACT_UPDATE_TRUST=production
export EXACT_APPLE_INTENT_FILES=0 EXACT_WATCH_SYNC=0 EXACT_WIDGET_GALLERY=0 IPHONEOS_DEPLOYMENT_TARGET=17.0
export EXACT_LIB_DIR="$CARGO_TARGET_DIR/aarch64-apple-ios/balanced" EXACT_LIB=apps_apple
unset SDKROOT
args=(build -c release --scratch-path "$scratch" --triple arm64-apple-ios17.0 --sdk "$sdk" -Xcc -isysroot -Xcc "$sdk" -Xlinker -syslibroot -Xlinker "$sdk" -Xswiftc -Xclang-linker -Xswiftc -isysroot -Xswiftc -Xclang-linker -Xswiftc "$sdk")
for target in ExactUpdates ExactMarkdown ExactNativeViews; do swift "${args[@]}" --target "$target"; done
out="$RUNNER_TEMP/ios-host-catalog"
[[ ! -e "$out" ]]
mkdir -p "$out/host-objects"
for target in ExactCore ExactKit ExactUpdates ExactMarkdown ExactFormaBinding ExactHeavyLeaves ExactNativeViews; do
  [[ -f "$product/$target.o" && -d "$product/$target.swiftmodule" ]]
  cp "$product/$target.o" "$out/host-objects/"
  cp -R "$product/$target.swiftmodule" "$out/host-objects/"
done
python3 - "$scripts" "$kit" "$out" "$EXACT_REF" <<'PY'
import hashlib,importlib.util,json,sys
from pathlib import Path
scripts,kit,out,ref=Path(sys.argv[1]),Path(sys.argv[2]),Path(sys.argv[3]),sys.argv[4]
spec=importlib.util.spec_from_file_location('proof',scripts/'ios-link-kit.py'); proof=importlib.util.module_from_spec(spec);spec.loader.exec_module(proof)
r=json.loads((kit/'kit.json').read_text()); assert r['toolchain']==proof.toolchain()
for name in ('ExactCore','ExactKit','ExactUpdates'):
 candidates=[x for x in r['digests'] if x.endswith('-'+name+'.o')]; assert len(candidates)==1
 assert proof.digest(out/'host-objects'/(name+'.o'))==r['digests'][candidates[0]],name
files={}
for p in sorted((out/'host-objects').rglob('*')):
 if p.is_dir(): continue
 assert p.is_file() and not p.is_symlink() and p.suffix in ('.o','.swiftmodule','.swiftdoc','.json')
 files[str(p.relative_to(out))]=proof.digest(p)
(out/'manifest.json').write_text(json.dumps({'ref':ref,'toolchain':proof.toolchain(),'target':'arm64-apple-ios17.0','profile':'release-balanced','conditions':{'intent_files':False,'widget_gallery':False,'watch_sync':False,'composition':'updating'},'files':files},sort_keys=True)+'\n')
PY
COPYFILE_DISABLE=1 tar -C "$out" -cf - . | zstd -T0 -3 -o "$RUNNER_TEMP/kit-out/ios-host-catalog.zst"
