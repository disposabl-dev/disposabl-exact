#!/usr/bin/env python3
"""Adapt the upstream Apple host for CI's Apple Silicon preview targets."""

from pathlib import Path
import sys


def edit(path, old, new):
    file = exact / path
    source = file.read_text()
    if new in source:
        return
    if source.count(old) != 1:
        raise SystemExit(f"Exact Apple cross-build compatibility changed in {path}")
    file.write_text(source.replace(old, new))


exact = Path(sys.argv[1])
platform = sys.argv[2]
edit(
    "packages/contacts/apple/ContactStore.swift",
    "    @State private var shown = true",
    "    private typealias PickerState = SwiftUI.State<Bool>\n"
    "    @PickerState private var shown = true",
)
if platform == "macos":
    edit(
        "scripts/app.mjs",
        "  if (platform === 'ios') return 'aarch64-apple-ios';\n  // Ask the pinned toolchain",
        "  if (platform === 'ios') return 'aarch64-apple-ios';\n"
        "  if (platform === 'macos' && process.platform === 'linux') return 'aarch64-apple-darwin';\n"
        "  // Ask the pinned toolchain",
    )
    edit(
        "host/apple/build.mjs",
        "export const macTriple = `${process.arch === 'arm64' ? 'arm64' : 'x86_64'}-apple-macosx`;",
        "const macArch = process.platform === 'linux' || process.arch === 'arm64' ? 'arm64' : 'x86_64';\n"
        "export const macTriple = `${macArch}-apple-macosx`;",
    )
    edit(
        "host/apple/build.mjs",
        "  const macArch = process.arch === 'arm64' ? 'arm64' : 'x86_64';\n  const simulatorArch",
        "  // macArch follows the Apple Silicon cross target above.\n"
        "  const simulatorArch",
    )
    edit(
        "host/apple/build.mjs",
        "`${process.arch === 'arm64' ? 'arm64' : 'x86_64'}-apple-macos${targets.macos}`",
        "`${macTriple}${targets.macos}`",
    )
    edit(
        "host/apple/bundle.mjs",
        "target: process.arch === 'arm64' ? 'aarch64-apple-darwin' : 'x86_64-apple-darwin'",
        "target: process.platform === 'linux' || process.arch === 'arm64' ? 'aarch64-apple-darwin' : 'x86_64-apple-darwin'",
    )
    # iconutil's .icns output is a container of PNG icon sizes.
    edit(
        "host/apple/assets.mjs",
        "    run('iconutil', ['-c', 'icns', set, '-o', resolve(dir, 'AppIcon.icns')], { stdio: 'ignore' });",
        """    const out = resolve(dir, 'AppIcon.icns');
    if (process.platform === 'linux') {
      const entries = [
        ['icp4', 16], ['icp5', 32], ['ic07', 128], ['ic08', 256], ['ic09', 512],
        ['ic11', 16, '@2x'], ['ic12', 32, '@2x'], ['ic13', 128, '@2x'], ['ic14', 256, '@2x'], ['ic10', 512, '@2x'],
      ];
      const chunk = (type, bytes) => {
        const header = Buffer.alloc(8);
        header.write(type, 'ascii');
        header.writeUInt32BE(8 + bytes.length, 4);
        return Buffer.concat([header, bytes]);
      };
      const icons = entries.map(([type, size, scale = '']) =>
        chunk(type, readFileSync(resolve(set, `icon_${size}x${size}${scale}.png`))));
      writeFileSync(out, chunk('icns', Buffer.concat(icons)));
    } else {
      run('iconutil', ['-c', 'icns', set, '-o', out], { stdio: 'ignore' });
    }""",
    )
