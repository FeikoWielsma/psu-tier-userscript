"""Assemble the Firefox/WebExtension package (zip) from the userscript.

This reads metadata from userscript.template.js/generate_userscript.py,
creates a manifest.json matching the userscript configuration,
and packages it along with the icon into a deployable zip file.
"""

import argparse
import json
import os
import zipfile
from pathlib import Path

from snapshot import ROOT


def make_manifest(userscript_src):
    # Parse metadata block from the userscript source
    metadata = {}
    in_metadata = False
    for line in userscript_src.splitlines():
        if "==UserScript==" in line:
            in_metadata = True
            continue
        if "==/UserScript==" in line:
            break
        if in_metadata:
            line = line.strip()
            if line.startswith("//"):
                content = line[2:].strip()
                parts = content.split(None, 1)
                if len(parts) == 2:
                    key = parts[0].strip()
                    val = parts[1].strip()
                    if key.startswith("@"):
                        key = key[1:]
                        if key in metadata:
                            if isinstance(metadata[key], list):
                                metadata[key].append(val)
                            else:
                                metadata[key] = [metadata[key], val]
                        else:
                            metadata[key] = val

    # Extract properties
    name = metadata.get("name", "PSU Tier Badges")
    version = metadata.get("version", "1.0.0")
    description = metadata.get("description", "")
    matches = metadata.get("match", [])
    if isinstance(matches, str):
        matches = [matches]
    expanded_matches = []
    for m in matches:
        if m not in expanded_matches:
            expanded_matches.append(m)
        if "://*." in m:
            apex = m.replace("://*.", "://")
            if apex not in expanded_matches:
                expanded_matches.append(apex)
    matches = expanded_matches

    # Map run-at
    run_at_raw = metadata.get("run-at", "document-idle")
    run_at_map = {
        "document-start": "document_start",
        "document-end": "document_end",
        "document-idle": "document_idle",
    }
    run_at = run_at_map.get(run_at_raw, "document_idle")

    # Construct manifest.json for Manifest V3 extension
    manifest = {
        "manifest_version": 3,
        "name": name,
        "version": version,
        "description": description,
        "icons": {
            "16": "icon-16.png",
            "32": "icon-32.png",
            "48": "icon-48.png",
            "128": "icon-128.png",
        },
        "content_scripts": [{"matches": matches, "js": ["content.js"], "run_at": run_at}],
        "browser_specific_settings": {
            "gecko": {
                "id": "psu-tier-badges@feikowielsma.github.io",
                "data_collection_permissions": {"required": ["none"]},
            }
        },
    }

    return manifest


def package(userscript_src, dist_dir, zip_filename):
    manifest = make_manifest(userscript_src)
    expected_files = {"manifest.json", "content.js", *(f"icon-{n}.png" for n in (16, 32, 48, 128))}
    if os.path.exists(dist_dir) and any(
        p.name not in expected_files for p in Path(dist_dir).iterdir()
    ):
        raise ValueError(
            "Extension output directory contains unexpected files; use a clean directory"
        )
    os.makedirs(dist_dir, exist_ok=True)

    # Write manifest.json
    manifest_path = os.path.join(dist_dir, "manifest.json")
    with open(manifest_path, "w", encoding="utf-8", newline="\n") as f:
        json.dump(manifest, f, indent=2)

    # Write content.js
    content_path = os.path.join(dist_dir, "content.js")
    with open(content_path, "w", encoding="utf-8", newline="\n") as f:
        f.write(userscript_src)

    # Copy PNG icons
    for size in [16, 32, 48, 128]:
        icon_name = f"icon-{size}.png"
        icon_src = ROOT / "extension" / icon_name
        icon_dst = os.path.join(dist_dir, icon_name)
        if os.path.exists(icon_src):
            import shutil

            shutil.copy2(icon_src, icon_dst)
        else:
            raise FileNotFoundError(icon_src)

    print(f"Packaging extension into {zip_filename}...")

    with zipfile.ZipFile(zip_filename, "w", zipfile.ZIP_DEFLATED) as zipf:
        for file_path in sorted(Path(dist_dir).iterdir()):
            info = zipfile.ZipInfo(file_path.name, date_time=(1980, 1, 1, 0, 0, 0))
            info.compress_type = zipfile.ZIP_DEFLATED
            info.external_attr = 0o100644 << 16
            zipf.writestr(info, file_path.read_bytes())

    print(f"Extension built successfully: {zip_filename}")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--userscript", type=Path, default=ROOT / "psutier.user.js")
    parser.add_argument("--dist", type=Path, default=ROOT / "dist-extension")
    parser.add_argument("--output", type=Path, default=ROOT / "psutier-extension.zip")
    args = parser.parse_args()
    package(args.userscript.read_text(encoding="utf-8"), args.dist, args.output)


if __name__ == "__main__":
    main()
