"""Full offline validation of reviewed data and the exact release artifacts.

Run python snapshot.py --refresh separately, then review its diff before release.
--quick omits browser tests for local iteration and cannot attest a release.
"""

import argparse
import json
import os
import subprocess
import sys

from snapshot import ROOT, SNAPSHOT, json_bytes, verify_snapshot
from verify_artifacts import validation_inputs, verify_artifacts


def run(command, env):
    print("$ " + " ".join(map(str, command)), flush=True)
    subprocess.run(command, cwd=ROOT, env=env, check=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--release", action="store_true")
    parser.add_argument("--quick", action="store_true")
    args = parser.parse_args()
    if args.release and args.quick:
        parser.error("Release validation cannot skip browser tests")
    verify_snapshot()
    reports = ROOT / "reports"
    reports.mkdir(exist_ok=True)
    (reports / "release-validation.json").unlink(missing_ok=True)
    env = dict(os.environ, PSU_DATA_FILE=str(SNAPSHOT))
    commands = [
        ["node", "tools/check.cjs"],
        ["uvx", "ruff", "check", "."],
        [sys.executable, "-m", "unittest", "discover", "-s", "tests", "-p", "test_*.py"],
        [sys.executable, "generate_userscript.py", "--data", str(SNAPSHOT)],
        [sys.executable, "build_extension.py"],
        ["node", "--check", "psutier.user.js"],
    ]
    if not args.quick:
        commands.append(["node", "tools/check.cjs", "--browser"])
    for command in commands:
        run(command, env)
    report = verify_artifacts()
    report["checks"] = commands
    report["releaseValidated"] = not args.quick
    report["validationInputs"] = validation_inputs()
    (reports / "release-validation.json").write_bytes(json_bytes(report))
    print(json.dumps(report, indent=2))
    print("All requested checks passed.")


if __name__ == "__main__":
    main()
