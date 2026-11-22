#!/usr/bin/env python3
"""Check that an iOS archive contains one device-arm64 app executable."""
import plistlib
import struct
import sys
import zipfile


def check_macho(data):
    if len(data) < 32:
        raise ValueError('truncated Mach-O')
    magic, cpu, _, _, commands, size, _, _ = struct.unpack_from('<8I', data)
    if magic != 0xfeedfacf or cpu != 0x0100000c:
        raise ValueError('app executable is not a 64-bit arm64 Mach-O')
    end = 32 + size
    if end > len(data):
        raise ValueError('truncated Mach-O load commands')
    offset = 32
    ios = False
    for _ in range(commands):
        if offset + 8 > end:
            raise ValueError('truncated Mach-O load command')
        kind, length = struct.unpack_from('<II', data, offset)
        if length < 8 or offset + length > end:
            raise ValueError('invalid Mach-O load command')
        if kind == 0x32 and length >= 24:
            ios |= struct.unpack_from('<I', data, offset + 8)[0] == 2
        elif kind == 0x25 and length >= 16:
            ios = True
        offset += length
    if offset != end or not ios:
        raise ValueError('Mach-O does not declare the iOS device platform')


def check_archive(path):
    with zipfile.ZipFile(path) as archive:
        names = archive.namelist()
        plists = [name for name in names if name.startswith('Payload/') and
                  name.endswith('.app/Info.plist') and name.count('/') == 2]
        if len(plists) != 1:
            raise ValueError('archive must contain one app Info.plist')
        plist = plistlib.loads(archive.read(plists[0]))
        executable = plist.get('CFBundleExecutable')
        if not isinstance(executable, str) or not executable or '/' in executable or executable in ('.', '..'):
            raise ValueError('invalid CFBundleExecutable')
        name = plists[0].removesuffix('Info.plist') + executable
        if names.count(name) != 1:
            raise ValueError('app executable is missing or duplicated')
        check_macho(archive.read(name))
    print('Verified iOS device arm64 Mach-O and app plist')


if __name__ == '__main__':
    try:
        check_archive(sys.argv[1])
    except (IndexError, KeyError, ValueError, zipfile.BadZipFile, plistlib.InvalidFileException, struct.error) as error:
        sys.exit(f'iOS archive verification failed: {error}')
