"""Provision missing mobile update keys with the user's existing GitHub CLI login."""
import json
import argparse
from pathlib import Path
import subprocess
import tempfile


def gh(*args, payload=None):
    return subprocess.check_output(["gh", *args], text=True,
                                   input=json.dumps(payload) if payload is not None else None).strip()


repo = gh("repo", "view", "--json", "nameWithOwner", "--jq", ".nameWithOwner")
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("--play", action="store_true", help="also provision the optional Play upload key")
args = parser.parse_args()
ref = "main"
sha = gh("api", f"repos/{repo}/commits/{ref}", "--jq", ".sha")

recipients = {}
for env in ("android-preview", "android-production"):
    path = f"repos/{repo}/environments/{env}/secrets"
    existing = gh("api", path, "--paginate", "--jq", ".secrets[].name").splitlines()
    wanted = ["EXACT_UPDATE_SEED"]
    if env == "android-production":
        wanted += ["ANDROID_APK_SIGNING"]
        if args.play:
            wanted += ["ANDROID_PLAY_UPLOAD_SIGNING"]
    missing = [name for name in wanted if name not in existing]
    if missing:
        recipients[env] = {**json.loads(gh("api", path + "/public-key")), "names": missing}

if not recipients:
    print("All requested signing keys are already configured.")
    raise SystemExit

run_url = gh("workflow", "run", "signing.yml", "--repo", repo, "--ref", ref, "--json",
             payload={"recipients": json.dumps(recipients)})
run = run_url.rstrip("/").split("/")[-1]
if not run.isdecimal():
    raise ValueError(f"Unexpected GitHub workflow response: {run_url}")
print(f"Generating signing keys in {run_url}", flush=True)
gh("run", "watch", run, "--repo", repo, "--exit-status", "--interval", "5")
if gh("run", "view", run, "--repo", repo, "--json", "headSha,workflowName,event",
      "--jq", '[.headSha,.workflowName,.event] | join(" ")') != f"{sha} Provision mobile signing workflow_dispatch":
    raise ValueError("Signing run does not match the selected workflow and commit")
with tempfile.TemporaryDirectory() as directory:
    gh("run", "download", run, "--repo", repo, "--name", "sealed-keys", "--dir", directory)
    for env, spec in recipients.items():
        path = f"repos/{repo}/environments/{env}/secrets"
        for name in spec["names"]:
            sealed = json.loads(Path(directory, f"{env}-{name}.json").read_text())
            if sealed["key_id"] != gh("api", path + "/public-key", "--jq", ".key_id"):
                raise ValueError("GitHub environment encryption key changed; run setup again")
            if name in gh("api", path, "--paginate", "--jq", ".secrets[].name").splitlines():
                print(f"Keeping {env}/{name}")
                continue
            gh("api", "--method", "PUT", f"{path}/{name}", "--input", "-", payload=sealed)
            print(f"Stored {env}/{name}")
