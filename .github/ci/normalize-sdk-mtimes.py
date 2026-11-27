#!/usr/bin/env python3
"""Normalize the pinned checkout's tracked inputs, including watched directories."""
import os
from pathlib import Path
import subprocess

root = Path.cwd()
paths = subprocess.check_output(['git', 'ls-files', '-z']).split(b'\0')
directories = set()
for raw in paths:
    if not raw:
        continue
    path = root / os.fsdecode(raw)
    if path.exists() and not path.is_symlink():
        os.utime(path, (1577836800, 1577836800))
    parent = path.parent
    while parent != root:
        directories.add(parent)
        parent = parent.parent
# Cargo build scripts can watch a directory, not only the files it contains.
for directory in directories:
    if directory.is_dir() and not directory.is_symlink():
        os.utime(directory, (1577836800, 1577836800))
