#!/usr/bin/env python3
"""Use a qualified SDK host catalog or fall back to the stock link proof."""
import os,subprocess,sys
from pathlib import Path
args=sys.argv[1:]; scripts=Path(__file__).resolve().parent
if not args or args[0]!='link': raise SystemExit('link only')
if os.environ.get('EXACT_HOST_CATALOG'):
 result=subprocess.run([sys.executable,str(scripts/'ios-general-link.py'),*args],capture_output=True,text=True)
 if result.returncode==0:
  print('host catalog: verified fresh-archive link'); raise SystemExit(0)
 print('host catalog refused; trying stock link kit',file=sys.stderr)
 if '--out' in args: Path(args[args.index('--out')+1]).unlink(missing_ok=True)
result=subprocess.run([sys.executable,str(scripts/'ios-link-kit.py'),*args])
raise SystemExit(result.returncode)
