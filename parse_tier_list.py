"""Parse the PSU tier-list CSV into a normalized list of PSU entries.

The CSV (see ``fetch_sheet.py``) has a fixed column layout. Brand (col 0) and
Series (col 1) are merged cells in the sheet, so the export leaves them blank
on continuation rows - we forward-fill those. The two variant columns (2, 3)
are per-row qualifiers (e.g. "II", "Bronze", "Non-Modular"); wattage and
efficiency disambiguate rows that share a series, so we do not fill them.
"""

import csv
import json
import re
import sys

INPUT_FILE = "psu_tier.csv"
OUTPUT_FILE = "psu_data.json"

# Column indices (0-based) in the gviz CSV export.
COL_BRAND = 0
COL_SERIES = 1
COL_VARIANT_1 = 2
COL_VARIANT_2 = 3
COL_WATTAGE = 4
COL_TIER = 5
COL_YEAR = 6
COL_SIZE = 7
COL_ATX = 8
COL_INPUT = 9
COL_MODULARITY = 10
COL_EFFICIENCY = 11
COL_TOPO_PRIMARY = 12
COL_TOPO_SECONDARY = 13
COL_TOPO_REGULATION = 14
COL_ODM = 15
COL_PLATFORM = 16
COL_NOTES = 17
N_COLS = 18

VALID_TIER = re.compile(r"^[A-F][+-]?$")

EFFICIENCY_MAP = {
    "W": "80+ White/Standard",
    "B": "80+ Bronze",
    "S": "80+ Silver",
    "G": "80+ Gold",
    "P": "80+ Platinum",
    "T": "80+ Titanium",
    "N": "Unrated/None",
}


def clean(text):
    """Collapse internal whitespace/newlines and strip surrounding junk."""
    if not text:
        return ""
    return re.sub(r"\s+", " ", text).strip()


def clean_series(text):
    """Series cleanup: drop parenthetical notes but keep the core name."""
    text = clean(text)
    text = re.sub(r"\s*\(.*?\)", "", text)
    return text.strip(" -")


def build_variant(c1, c2):
    """Join the two variant columns, dropping placeholder dashes."""
    parts = [clean(c1), clean(c2)]
    parts = [p for p in parts if p and p != "-"]
    return " ".join(parts)


def parse_csv(path):
    with open(path, encoding="utf-8") as f:
        rows = list(csv.reader(f))
    if not rows:
        return []

    entries = []
    brand = series = ""
    for row in rows[1:]:  # skip header
        row = (row + [""] * N_COLS)[:N_COLS]
        if row[COL_BRAND].strip():
            brand = clean(row[COL_BRAND])
        if row[COL_SERIES].strip():
            series = clean(row[COL_SERIES])

        tier = clean(row[COL_TIER])
        if not VALID_TIER.match(tier):
            continue  # section headers, blanks, footnotes

        series_clean = clean_series(series)
        variant = build_variant(row[COL_VARIANT_1], row[COL_VARIANT_2])
        model = " ".join(p for p in (series_clean, variant) if p)

        eff_code = clean(row[COL_EFFICIENCY])
        efficiency = EFFICIENCY_MAP.get(eff_code, eff_code) if eff_code else None

        topology = " + ".join(
            p for p in (clean(row[COL_TOPO_PRIMARY]),
                        clean(row[COL_TOPO_SECONDARY]),
                        clean(row[COL_TOPO_REGULATION])) if p
        )

        # Apply local data corrections/patches for sheet gaps or erroneous values
        wattage = clean(row[COL_WATTAGE]) or None
        if brand == "NZXT" and series_clean == "C Series" and variant == "Core ATX 3.1 (2025)":
            wattage = "750/850/1000W"

        entries.append({
            "brand": brand,
            "series": series_clean,
            "variant": variant or None,
            "model": model,
            "wattage": wattage,
            "tier": tier,
            "year": clean(row[COL_YEAR]) or None,
            "form_factor": clean(row[COL_SIZE]) or None,
            "atx_version": clean(row[COL_ATX]) or None,
            "input_range": clean(row[COL_INPUT]) or None,
            "modularity": clean(row[COL_MODULARITY]) or None,
            "efficiency": efficiency,
            "topology": topology or None,
            "odm": clean(row[COL_ODM]) or None,
            "platform": clean(row[COL_PLATFORM]) or None,
            "notes": clean(row[COL_NOTES]) or None,
        })

    return entries


def main():
    entries = parse_csv(INPUT_FILE)
    if not entries:
        print("ERROR: parsed 0 entries - check the CSV input.", file=sys.stderr)
        sys.exit(1)
    with open(OUTPUT_FILE, "w", encoding="utf-8") as f:
        json.dump(entries, f, indent=2, ensure_ascii=False)
    print(f"Extracted {len(entries)} PSU entries -> {OUTPUT_FILE}")


if __name__ == "__main__":
    main()
