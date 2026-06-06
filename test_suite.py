"""Convenience local runner: build the userscript and run the JS test suite.

Mirrors CI. The deterministic tests (npm test) run against the committed data
snapshot, so they don't need network access. Pass --update to also refresh the
data from the live sheet before building.

    python test_suite.py            # build from current data + run tests
    python test_suite.py --update   # fetch latest sheet, build, run tests
"""

import os
import shutil
import subprocess
import sys

BASE = os.path.dirname(os.path.abspath(__file__))


def run(cmd):
    print(f"\n$ {cmd}")
    if subprocess.call(cmd, shell=True, cwd=BASE) != 0:
        sys.exit(f"Command failed: {cmd}")


def main():
    update = "--update" in sys.argv

    if update:
        run(f"{sys.executable} fetch_sheet.py")
        run(f"{sys.executable} parse_tier_list.py")

    # Ensure data exists (fall back to the committed snapshot).
    if not os.path.exists(os.path.join(BASE, "psu_data.json")):
        print("No psu_data.json; using committed snapshot.")
        shutil.copy(
            os.path.join(BASE, "tests", "fixtures", "sample_psu_data.json"),
            os.path.join(BASE, "psu_data.json"),
        )

    run(f"{sys.executable} generate_userscript.py --test")
    run("npm run lint")
    run("npm run typecheck")
    run("uvx ruff check .")
    run("npm test")
    print("\nAll checks passed.")


if __name__ == "__main__":
    main()
