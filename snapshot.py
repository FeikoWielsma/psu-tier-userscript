"""Reviewable sheet refreshes and validation of the committed release input.

Refreshing never publishes. Review the semantic diff and commit all changed
snapshot files together before tagging a release.
"""

import argparse
import hashlib
import json
import os
import re
import tempfile
from datetime import datetime, timezone
from pathlib import Path

import fetch_sheet
from parse_tier_list import parse_csv

ROOT = Path(__file__).resolve().parent
SNAPSHOT = ROOT / "tests/fixtures/sample_psu_data.json"
METADATA = ROOT / "tests/fixtures/sheet/metadata.json"
SOURCES = {"proper": fetch_sheet.GID_PROPER, "limited": fetch_sheet.GID_LIMITED}
IDENTITY_FIELDS = (
    "brand",
    "model",
    "wattage",
    "year",
    "form_factor",
    "efficiency",
    "modularity",
    "input_range",
    "atx_version",
    "is_limited",
    "tier",
)


def sha256(content):
    return hashlib.sha256(content).hexdigest()


def json_bytes(value):
    return (json.dumps(value, indent=2, ensure_ascii=False) + "\n").encode("utf-8")


def validate_data(data):
    if not isinstance(data, list) or not data:
        raise ValueError("Dataset must be a nonempty array")
    for i, entry in enumerate(data):
        if not isinstance(entry, dict):
            raise ValueError(f"Invalid entry {i}")
        for field in ("brand", "model"):
            if not isinstance(entry.get(field), str) or not entry[field].strip():
                raise ValueError(f"Entry {i}: invalid {field}")
        if not isinstance(entry.get("tier"), str) or not re.fullmatch(r"[A-F][+-]?", entry["tier"]):
            raise ValueError(f"Entry {i}: invalid tier")
        if not isinstance(entry.get("is_limited"), bool):
            raise ValueError(f"Entry {i}: invalid is_limited")
        for field in IDENTITY_FIELDS[2:-2]:
            if entry.get(field) is not None and not isinstance(entry[field], str):
                raise ValueError(f"Entry {i}: invalid {field}")
    return data


def load_data(path=SNAPSHOT):
    return validate_data(json.loads(Path(path).read_text(encoding="utf-8")))


def verify_snapshot():
    """Reparse frozen CSV evidence and require byte-identical reviewed data."""
    metadata = json.loads(METADATA.read_text(encoding="utf-8"))
    parsed = []
    for name, gid in SOURCES.items():
        source = metadata["sources"][name]
        path = METADATA.parent / f"{name}.csv"
        if (
            source["url"] != fetch_sheet.get_url(gid)
            or sha256(path.read_bytes()) != source["sha256"]
        ):
            raise ValueError(f"Source provenance mismatch: {name}")
        parsed.extend(parse_csv(path, only_limited=name == "limited", source_gid=gid))
    validate_data(parsed)
    actual = SNAPSHOT.read_bytes()
    if actual != json_bytes(parsed) or sha256(actual) != metadata["dataset_sha256"]:
        raise ValueError("Snapshot does not match its frozen CSV evidence and metadata")
    if len(parsed) != metadata["entries"]:
        raise ValueError("Snapshot entry count mismatch")
    return metadata


def semantic_diff(before, after):
    from collections import Counter, defaultdict

    def keyed(entries):
        # Count duplicate identities rather than hiding them in a set.
        return Counter(json.dumps([e.get(k) for k in IDENTITY_FIELDS]) for e in entries)

    def quality(entries):
        counts = keyed(entries)
        tiers = defaultdict(set)
        for entry in entries:
            identity = json.dumps([entry.get(k) for k in IDENTITY_FIELDS if k != "tier"])
            tiers[identity].add(entry.get("tier"))
        return {
            "missing_fields": {
                key: sum(e.get(key) in (None, "") for e in entries) for key in IDENTITY_FIELDS
            },
            "duplicate_identities": [
                {"identity": json.loads(key), "count": count}
                for key, count in sorted(counts.items())
                if count > 1
            ],
            "conflicting_tiers": [
                {"identity_without_tier": json.loads(key), "tiers": sorted(values)}
                for key, values in sorted(tiers.items())
                if len(values) > 1
            ],
        }

    old, new = keyed(before), keyed(after)
    return {
        "before": len(before),
        "after": len(after),
        "removed_or_changed": [json.loads(k) for k in (old - new).elements()],
        "added_or_changed": [json.loads(k) for k in (new - old).elements()],
        "identity_fields": IDENTITY_FIELDS,
        "quality_before": quality(before),
        "quality_after": quality(after),
    }


def refresh():
    before = load_data()
    with tempfile.TemporaryDirectory() as directory:
        stage = Path(directory)
        entries = []
        metadata = {"retrieved_at": datetime.now(timezone.utc).isoformat(), "sources": {}}
        updates = {}
        for name, gid in SOURCES.items():
            raw = fetch_sheet.fetch(fetch_sheet.get_url(gid)).encode("utf-8")
            path = stage / f"{name}.csv"
            path.write_bytes(raw)
            parsed = parse_csv(path, only_limited=name == "limited", source_gid=gid)
            if not parsed:
                raise ValueError(f"No entries in {name} source")
            entries.extend(parsed)
            metadata["sources"][name] = {
                "url": fetch_sheet.get_url(gid),
                "sha256": sha256(raw),
                "entries": len(parsed),
            }
            updates[METADATA.parent / f"{name}.csv"] = raw
        validate_data(entries)
        dataset = json_bytes(entries)
        metadata.update(entries=len(entries), dataset_sha256=sha256(dataset))
        report = semantic_diff(before, entries)
        updates[METADATA.parent / "diff.json"] = json_bytes(report)
        updates[METADATA] = json_bytes(metadata)
        updates[SNAPSHOT] = dataset
        # No destination is touched before both sources parse and validate.
        # Roll back ordinary write failures. Provenance validation also detects
        # interrupted multi-file updates after an abrupt process/machine exit.
        previous = {p: p.read_bytes() if p.exists() else None for p in updates}
        try:
            for path, content in updates.items():
                atomic_write(path, content)
        except OSError:
            for path, content in previous.items():
                if content is None:
                    path.unlink(missing_ok=True)
                else:
                    atomic_write(path, content)
            raise
    print(json.dumps(report, indent=2))
    print("Review and commit the snapshot, CSV evidence, metadata and semantic diff together.")


def atomic_write(path, content):
    path.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile(dir=path.parent, delete=False) as stream:
        temporary = Path(stream.name)
        stream.write(content)
    try:
        os.replace(temporary, path)
    finally:
        temporary.unlink(missing_ok=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--refresh", action="store_true")
    args = parser.parse_args()
    if args.refresh:
        refresh()
    else:
        print(json.dumps(verify_snapshot(), indent=2))


if __name__ == "__main__":
    main()
