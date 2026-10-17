"""Verify the exact userscript, unpacked extension and zip before publishing."""

import json
import re
import zipfile
from pathlib import Path

from build_extension import make_manifest
from generate_userscript import build
from snapshot import ROOT, SNAPSHOT, sha256, verify_snapshot


def validation_inputs():
    """Only explicit project inputs; never scan local credentials or scratch files."""
    files = {
        ROOT / name
        for name in (
            "package.json",
            "package-lock.json",
            "eslint.config.js",
            "jsconfig.json",
            "pyproject.toml",
            "fetch_sheet.py",
            "parse_tier_list.py",
            "snapshot.py",
            "generate_userscript.py",
            "build_extension.py",
            "verify_artifacts.py",
            "test_suite.py",
            "tools/check.cjs",
            "tools/mutation-check.cjs",
            "tools/benchmark.cjs",
            "tools/tweakers_seed.json",
        )
    }
    for folder in ("src", "data", "tests", ".github/workflows"):
        files.update(
            p for p in (ROOT / folder).rglob("*") if p.is_file() and "__pycache__" not in p.parts
        )
    return {
        str(p.relative_to(ROOT)).replace("\\", "/"): sha256(p.read_bytes()) for p in sorted(files)
    }


def verify_artifacts(directory=ROOT, data_path=SNAPSHOT):
    directory = Path(directory)
    expected = build(data_path).encode("utf-8")
    script = directory / "psutier.user.js"
    extension = directory / "dist-extension"
    archive = directory / "psutier-extension.zip"
    if script.read_bytes() != expected or (extension / "content.js").read_bytes() != expected:
        raise ValueError("Built script differs from the selected data, rules or sources")
    manifest = json.loads((extension / "manifest.json").read_text(encoding="utf-8"))
    if manifest != make_manifest(expected.decode("utf-8")):
        raise ValueError("Extension manifest differs from userscript metadata")
    package = json.loads((ROOT / "package.json").read_text(encoding="utf-8"))
    if manifest["version"] != package["version"]:
        raise ValueError("package.json and userscript versions disagree")
    required = {"manifest.json", "content.js", *(f"icon-{n}.png" for n in (16, 32, 48, 128))}
    if {p.name for p in extension.iterdir()} != required:
        raise ValueError("Unpacked extension contains missing or unexpected files")
    with zipfile.ZipFile(archive) as zipped:
        names = zipped.namelist()
        if set(names) != required or len(names) != len(required):
            raise ValueError("Extension archive has missing, duplicate or unexpected files")
        for name in required:
            content = (extension / name).read_bytes()
            if zipped.read(name) != content:
                raise ValueError(f"Packaged file differs from validated extension: {name}")
            if name.startswith("icon-") and content != (ROOT / "extension" / name).read_bytes():
                raise ValueError(f"Packaged icon differs from source: {name}")
    signed = directory / "psutier-extension.xpi"
    if signed.exists():
        verify_signed_extension(signed, extension, required)
    match = re.search(r"^// PSU_BUILD (.+)$", expected.decode("utf-8"), re.M)
    return {
        "version": manifest["version"],
        "build": json.loads(match[1]),
        "artifacts": {
            name: sha256((directory / name).read_bytes())
            for name in ("psutier.user.js", "psutier-extension.zip")
        },
    }


def verify_signed_extension(signed, extension, required):
    """AMO may add signatures; application files must remain the tested bytes."""
    with zipfile.ZipFile(signed) as archive:
        names = archive.namelist()
        if len(names) != len(set(names)) or not required.issubset(names):
            raise ValueError("Signed extension has missing or duplicate files")
        if any(name not in required and not name.startswith("META-INF/") for name in names):
            raise ValueError("Signed extension has unexpected application files")
        for name in required:
            if archive.read(name) != (extension / name).read_bytes():
                raise ValueError(f"Signed extension differs from tested artifact: {name}")


def main():
    verify_snapshot()
    actual = verify_artifacts()
    report_path = ROOT / "reports/release-validation.json"
    report = json.loads(report_path.read_text(encoding="utf-8"))
    verify_attestation(report, actual)
    print(json.dumps(actual, indent=2))


def verify_attestation(report, actual):
    """A consistent rebuild is not proof that those bytes passed the tests."""
    if report.get("releaseValidated") is not True:
        raise ValueError("Full release validation has not passed")
    for field in ("version", "build", "artifacts"):
        if report.get(field) != actual[field]:
            raise ValueError(f"Artifact changed after release validation: {field}")
    if report.get("validationInputs") != validation_inputs():
        raise ValueError("Validation inputs changed after the checks ran")


if __name__ == "__main__":
    main()
