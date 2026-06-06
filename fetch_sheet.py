"""Download SPL's PSU Tier List as CSV.

Uses the Google Sheets ``gviz`` CSV export endpoint rather than scraping the
``htmlview`` page. The htmlview endpoint now returns a Google Drive viewer
wrapper instead of the raw table, which silently broke the old parser. The
gviz endpoint returns clean CSV with a stable column layout and needs no
HTML parsing (and therefore no third-party dependencies).
"""

import logging
import sys
import urllib.request

logging.basicConfig(level=logging.INFO, format="%(levelname)s: %(message)s")

SHEET_ID = "1akCHL7Vhzk_EhrpIGkz8zTEvYfLDcaSpZRB6Xt6JWkc"
# The canonical, maintained tier-list tab. (The old "1973454078" tab is stale -
# it lacks entries like ASRock SL-P, the updated Lian Li SX-P, etc.)
GID = "1078495601"
URL = (
    f"https://docs.google.com/spreadsheets/d/{SHEET_ID}"
    f"/gviz/tq?tqx=out:csv&gid={GID}"
)
OUTPUT_FILE = "psu_tier.csv"


def fetch(url=URL, timeout=30):
    """Return the sheet CSV as text, raising on an obviously-wrong response."""
    logging.info("Downloading from %s ...", url)
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    with urllib.request.urlopen(req, timeout=timeout) as response:
        content = response.read().decode("utf-8", errors="replace")

    # The failure mode (auth wall / Drive wrapper) returns an HTML document.
    # A valid CSV export starts with the header row containing these labels.
    head = content[:2000]
    if head.lstrip().lower().startswith("<!doctype") or "<html" in head.lower():
        raise ValueError("Got an HTML page, not CSV - the sheet may be private "
                         "or the endpoint changed.")
    if "Brand" not in head or "Tier" not in head:
        raise ValueError("CSV header is missing expected 'Brand'/'Tier' columns.")
    return content


def main():
    try:
        content = fetch()
    except Exception as e:  # noqa: BLE001 - top-level CLI guard
        logging.error("Failed to download tier list: %s", e)
        sys.exit(1)

    with open(OUTPUT_FILE, "w", encoding="utf-8", newline="") as f:
        f.write(content)
    logging.info("Saved %d bytes to %s", len(content), OUTPUT_FILE)


if __name__ == "__main__":
    main()
