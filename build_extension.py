"""Assemble the Firefox/WebExtension package (zip) from the userscript.

This reads metadata from userscript.template.js/generate_userscript.py,
creates a manifest.json matching the userscript configuration,
and packages it along with the icon into a deployable zip file.
"""

import json
import os
import zipfile

from generate_userscript import build


def main():
    print("Building userscript source...")
    userscript_src = build()

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

    # Map run-at
    run_at_raw = metadata.get("run-at", "document-idle")
    run_at_map = {
        "document-start": "document_start",
        "document-end": "document_end",
        "document-idle": "document_idle"
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
            "128": "icon-128.png"
        },
        "content_scripts": [
            {
                "matches": matches,
                "js": ["content.js"],
                "run_at": run_at
            }
        ],
        "browser_specific_settings": {
            "gecko": {
                "id": "psu-tier-badges@feikowielsma.github.io",
                "data_collection_permissions": {
                    "required": ["none"]
                }
            }
        }
    }

    dist_dir = "dist-extension"
    if os.path.exists(dist_dir):
        import shutil
        shutil.rmtree(dist_dir)
    os.makedirs(dist_dir, exist_ok=True)

    # Write manifest.json
    manifest_path = os.path.join(dist_dir, "manifest.json")
    with open(manifest_path, "w", encoding="utf-8") as f:
        json.dump(manifest, f, indent=2)

    # Write content.js
    content_path = os.path.join(dist_dir, "content.js")
    with open(content_path, "w", encoding="utf-8") as f:
        f.write(userscript_src)

    # Copy PNG icons
    for size in [16, 32, 48, 128]:
        icon_name = f"icon-{size}.png"
        icon_src = os.path.join("extension", icon_name)
        icon_dst = os.path.join(dist_dir, icon_name)
        if os.path.exists(icon_src):
            import shutil
            shutil.copy2(icon_src, icon_dst)
        else:
            print(f"Warning: {icon_src} not found")

    zip_filename = "psutier-extension.zip"
    print(f"Packaging extension into {zip_filename}...")

    with zipfile.ZipFile(zip_filename, "w", zipfile.ZIP_DEFLATED) as zipf:
        for root, _dirs, files in os.walk(dist_dir):
            for file in files:
                file_path = os.path.join(root, file)
                arcname = os.path.relpath(file_path, dist_dir)
                zipf.write(file_path, arcname)

    print(f"Extension built successfully: {zip_filename}")


if __name__ == "__main__":
    main()
