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
# The canonical, maintained tier-list tabs:
# 1078495601: Proper ratings
# 931697732: Full List (With Limited Confidence Ratings)
GID_PROPER = "1078495601"
GID_LIMITED = "931697732"

OUTPUT_PROPER = "psu_tier.csv"
OUTPUT_LIMITED = "psu_tier_limited.csv"


def get_url(gid):
    return (
        f"https://docs.google.com/spreadsheets/d/{SHEET_ID}"
        f"/gviz/tq?tqx=out:csv&gid={gid}"
    )


def fetch(url, timeout=30):
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
    # Fetch Proper Ratings
    try:
        content_proper = fetch(get_url(GID_PROPER))
        with open(OUTPUT_PROPER, "w", encoding="utf-8", newline="") as f:
            f.write(content_proper)
        logging.info("Saved %d bytes to %s", len(content_proper), OUTPUT_PROPER)
    except Exception as e:  # noqa: BLE001
        logging.error("Failed to download proper tier list: %s", e)
        sys.exit(1)

    # Fetch Limited Confidence Ratings
    try:
        content_limited = fetch(get_url(GID_LIMITED))
        with open(OUTPUT_LIMITED, "w", encoding="utf-8", newline="") as f:
            f.write(content_limited)
        logging.info("Saved %d bytes to %s", len(content_limited), OUTPUT_LIMITED)
    except Exception as e:  # noqa: BLE001
        logging.error("Failed to download limited confidence tier list: %s", e)
        sys.exit(1)


if __name__ == "__main__":
    main()
