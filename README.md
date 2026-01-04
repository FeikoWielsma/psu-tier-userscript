# PSU Tier List Userscript Generator 🔌

![CI Status](https://github.com/FeikoWielsma/psu-tier-userscript/actions/workflows/ci.yml/badge.svg)

A tool that parses **SPL's PSU Tier List** (Google Sheet) and generates a userscript (`psutier.user.js`). This userscript injects visible Tier Badges directly onto **PCPartPicker** product listing pages, helping you choose high-quality power supplies at a glance.

## 🌟 Features

*   **Live Injection**: Adds colored labels (Tier A, B, C, etc.) next to PSU names on PCPartPicker.
*   **Smart Matching**:
    *   Handles complex series names (e.g., "MWE Gold V2" matching "MWE V2 Gold").
    *   Filters out "noise" words to ensure accuracy.
    *   Verifies Wattage compatibility (e.g., matches "RMx 2018" only if wattage aligns with the specific unit details).
*   **Automated Updates**: The script is generated from the latest Tier List data.

## 🚀 Installation

### For Users
1.  Install a Userscript manager like **Tampermonkey** or **Violentmonkey** for your browser.
2.  Go to the [**Releases**](https://github.com/FeikoWielsma/psu-tier-userscript/releases) page.
3.  Download the latest `psutier.user.js`.
4.  Your extension should ask to install it. Click **Install**.
5.  Visit [PCPartPicker Power Supplies](https://pcpartpicker.com/products/power-supply/) and enjoy!

## 🛠️ Development

### Prerequisites
*   Python 3.x
*   Node.js (for running the validation tests)

### Setup
1.  Clone the repository:
    ```bash
    git clone https://github.com/FeikoWielsma/psu-tier-userscript.git
    cd psu-tier-userscript
    ```
2.  Install Python dependencies:
    ```bash
    pip install -r requirements.txt
    ```

### Building & Testing
We provide a master script that runs the entire pipeline (parsing -> generation -> testing):

```bash
python test_suite.py
```

**What this does:**
1.  `parse_tier_list.py`: Downloads and parses the latest Tier List HTML into `psu_data.json`.
2.  `generate_userscript.py`: Uses the JSON data to build `psutier.user.js` and `psu_lookup_map.json`.
3.  `tests/test_matching.js`: Runs a Node.js test suite against tricky matching cases (e.g., Antec/Atom, Corsair Revisions) to ensure the logic is sound.

## 🤖 CI/CD & Releases

This repository uses **GitHub Actions** to automate builds:
*   **CI**: Runs tests on every push. Artifacts (the generated script) are uploaded to the Action run.
*   **Release**: When you push a tag (e.g., `v1.0`), a GitHub Release is automatically created containing the ready-to-use `psutier.user.js` file.

## 📜 Credits
*   **Data Source**: [SPL's PSU Tier List](https://docs.google.com/spreadsheets/u/0/d/1akCHL7Vhzk_EhrpIGkz8zTEvYfLDcaSpZRB6Xt6JWkc/htmlview#gid=1973454078).
*   **PCPartPicker**: For being the platform this script enhances.

---
*Disclaimer: This tool is not affiliated with PCPartPicker or the spreadsheet maintainers.*
