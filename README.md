# PSU Tier List Userscript 🔌

![CI Status](https://github.com/FeikoWielsma/psu-tier-userscript/actions/workflows/ci.yml/badge.svg)

A tool that turns **SPL's PSU Tier List** (a Google Sheet) into a userscript that
injects coloured **Tier badges** directly onto power-supply listings on
**PCPartPicker** (all regions) and **Tweakers.net**, so you can judge PSU quality
at a glance.

Badges show match **confidence**: a solid badge is a confident match, a dashed
`Tier X?` badge is a *likely* match. Click any badge for full specs, the
confidence score, and other candidate matches.

> [!WARNING]
> Manufacturer naming is inconsistent across the tier sheet, PCPartPicker and
> Tweakers (and those three disagree with each other). The matcher is good but
> **false positives/negatives happen** — always confirm on the
> [official spreadsheet](https://docs.google.com/spreadsheets/d/1akCHL7Vhzk_EhrpIGkz8zTEvYfLDcaSpZRB6Xt6JWkc/htmlview)
> before buying. The badge confidence and "other possible matches" list are there
> to make disagreement visible rather than hidden.

## 🚀 Installation

1. Install a userscript manager:
   - **Brave / Chrome / Edge** (Chromium): install **Violentmonkey** (or
     Tampermonkey) from the Chrome Web Store.
   - **Firefox**: install Violentmonkey/Tampermonkey from Add-ons.
2. **Brave/Chrome only — enable user scripts** (required since Chromium tightened
   Manifest V3): open the extension's *Details*, and turn on **"Allow User
   Scripts"** if shown; on older builds toggle **Developer mode** on
   `brave://extensions` instead. (One-time step.)
3. Download the latest `psutier.user.js` from the
   [**Releases**](https://github.com/FeikoWielsma/psu-tier-userscript/releases)
   page — your manager will offer to install it.
4. Visit a [PCPartPicker PSU listing](https://pcpartpicker.com/products/power-supply/)
   or the [Tweakers Pricewatch](https://tweakers.net/voedingen/vergelijken/) and
   look for the badges.

## 🧠 How it works

```
Google Sheet ──gviz CSV──► fetch_sheet.py ──► psu_tier.csv
                                              │
                          parse_tier_list.py ─┘──► psu_data.json
                                              │
        ┌── src/matcher.js  (matching engine, single source of truth)
        ├── src/adapters.js (per-site DOM extraction)
        ├── data/normalization_rules.json (declarative tuning)
        └── src/userscript.template.js (UI)
                                              │
                        generate_userscript.py ──► psutier.user.js
```

- **Data source** is the sheet's `gviz` **CSV export** (stable columns, no HTML
  scraping, no third-party Python deps).
- **Matching** (`src/matcher.js`) tokenizes the product name and each candidate
  model and scores a weighted token overlap. It also uses the storefront's
  **structured columns** as signals, not just the name: wattage and form factor
  (ATX vs SFX) are hard filters, and efficiency disambiguates variants. When a
  name is too thin to score on its own (e.g. "NZXT C750" → just "c"), those
  signals resolve it by constraint (wattage + efficiency + form factor). The
  winning score is the confidence shown on the badge. This is the **single
  source of truth** — the userscript and the test suite run the exact same code.
- There are **no hardcoded per-product hacks.** Naming quirks are fixed by
  editing data, not code (see below).

### Fixing a naming mismatch (the extension point)

Edit [`data/normalization_rules.json`](data/normalization_rules.json):

- `aliases` — rewrite incoming product names (e.g. ASUS `"850G"` → `"850 gold"`).
- `strip` — remove descriptors that differ across sources and never identify a
  model (ATX version tags, the `80+` prefix, …); applied to both sides.
- `generic` / `noise` — words that score low / are dropped.
- `thresholds` / `weights` — confidence bands and scoring balance.

Add a case to [`tests/corpus.json`](tests/corpus.json), run `npm test`, done.

### Supporting a new site

Add one entry to [`src/adapters.js`](src/adapters.js):
`{ id, match, selector, filter?, extract, insertBadge }`, where `extract(row)`
returns `{ name, wattage, efficiency, formFactor, modular }` (pull as many of
those from structured columns as the site exposes — the matcher uses them).

## 🛠️ Development

**Prerequisites:** Python 3 (standard library only) and Node.js 20+.
This repo uses [`uv`](https://docs.astral.sh/uv/) for Python.

```bash
git clone https://github.com/FeikoWielsma/psu-tier-userscript.git
cd psu-tier-userscript
npm install
```

Build + test (deterministic, no network — uses the committed data snapshot):

```bash
python test_suite.py        # build + lint + typecheck + run npm test
npm run check               # eslint + tsc --checkJs + tests
npm test                    # just the JS tests
npm run lint                # ESLint (src, tests, tools)
npm run typecheck           # tsc --checkJs (type inference, no JSDoc needed)
uvx ruff check .            # Python lint
```

Refresh data from the live sheet and rebuild:

```bash
python generate_userscript.py --update
```

### Testing

- **`npm test`** — offline, deterministic, CI-safe:
  - `tests/test_matching.js` runs the real matcher over `tests/corpus.json`
    (hand-labelled cases, incl. verbose real PCPP names) against the committed
    `tests/fixtures/sample_psu_data.json`.
  - `tests/test_adapters.js` runs the real adapters over saved HTML fixtures via
    `linkedom` — including full real PCPartPicker pages in
    `tests/fixtures/pcpp/` (100 rows each) to catch name/wattage extraction and
    DOM drift.
  - `tests/test_coverage.js` runs the matcher over ~900 real, deduplicated
    product names (`tests/fixtures/pcpp-products.json`) and asserts it never
    throws and overall match coverage stays above a floor. (A full listing
    includes many genuinely unrated units, so <100% is expected.)
- **Live browser** (local, on demand — never in CI):
  ```bash
  npx playwright install chromium          # once
  npm run capture                          # refresh tests/fixtures/*.html
  npm run smoke                             # inject the script, report matches
  # drive Brave instead of bundled Chromium:
  node tools/live_capture.mjs --smoke --browser-path "C:\\Program Files\\BraveSoftware\\Brave-Browser\\Application\\brave.exe" --headed
  ```
  These do a handful of normal page loads with pauses — not bulk scraping.

## 🤖 CI/CD

- **CI** (`.github/workflows/ci.yml`): runs `npm test` (the deterministic gate),
  does a non-fatal live fetch/parse structure check, then builds and uploads the
  userscript artifact.
- **Release** (`.github/workflows/release.yml`): pushing a `v*` tag runs the
  tests, builds from the latest sheet, and publishes a GitHub Release with
  `psutier.user.js`.

## 📜 Credits

- **Data**: [SPL's PSU Tier List](https://docs.google.com/spreadsheets/d/1akCHL7Vhzk_EhrpIGkz8zTEvYfLDcaSpZRB6Xt6JWkc/htmlview).
- **PCPartPicker** and **Tweakers.net** for the platforms this enhances.

---
*Not affiliated with PCPartPicker, Tweakers, or the spreadsheet maintainers.*
