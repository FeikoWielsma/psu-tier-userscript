"""Assemble psutier.user.js from the template, matcher, data and rules.

The userscript is built by substituting three placeholders in
src/userscript.template.js:
  /*__PSU_DATA__*/  -> the reviewed committed sheet snapshot
  /*__RULES__*/     -> data/normalization_rules.json
  /*__MATCHER__*/   -> src/matcher.js verbatim (single source of truth)

Flags:
  --data     select an explicit alternative dataset for local validation
  --output   select the output script path
  --test     also emit psu_data_var.js for the Node test harness
"""

import argparse
import json
from pathlib import Path

from snapshot import ROOT, SNAPSHOT, load_data, sha256

TEMPLATE = "src/userscript.template.js"
MATCHER = "src/matcher.js"
ADAPTERS = "src/adapters.js"
DATA = SNAPSHOT
RULES = "data/normalization_rules.json"
OUTPUT = "psutier.user.js"


def js_safe(json_str):
    """Escape characters that could break out of a JS context.

    JSON permits raw ``<``/``>``/``&`` and the U+2028/U+2029 line separators;
    the former are an injection risk and the latter terminate JS string
    literals, so escape all of them.
    """
    return (
        json_str.replace("<", "\\u003c")
        .replace(">", "\\u003e")
        .replace("&", "\\u0026")
        .replace(chr(0x2028), "\\u2028")
        .replace(chr(0x2029), "\\u2029")
    )


def _indent(text, spaces):
    pad = " " * spaces
    return "\n".join(pad + line if line.strip() else line for line in text.splitlines())


def build(data_path=DATA):
    data = load_data(data_path)
    with open(ROOT / RULES, encoding="utf-8") as f:
        rules = json.load(f)
    with open(ROOT / MATCHER, encoding="utf-8") as f:
        matcher_src = f.read()
    with open(ROOT / ADAPTERS, encoding="utf-8") as f:
        adapters_src = f.read()
    with open(ROOT / TEMPLATE, encoding="utf-8") as f:
        template = f.read()

    # Format each PSU entry on its own line to avoid one massive single-line block
    # that degrades text editor layout and rendering performance.
    data_lines = [json.dumps(item, ensure_ascii=False) for item in data]
    data_json = "[\n" + ",\n".join("        " + line for line in data_lines) + "\n    ]"
    data_json = js_safe(data_json)

    rules_json = js_safe(json.dumps(rules, indent=4, ensure_ascii=False))
    rules_json = _indent(rules_json, 4).lstrip()

    replacements = {
        "/*__PSU_DATA__*/ []": data_json,
        "/*__RULES__*/ {}": rules_json,
        "        /*__MATCHER__*/": _indent(matcher_src, 8),
        "        /*__ADAPTERS__*/": _indent(adapters_src, 8),
    }
    out = template
    for placeholder, value in replacements.items():
        if placeholder not in out:
            raise ValueError(f"Template placeholder not found: {placeholder!r}")
        out = out.replace(placeholder, value)
    provenance = {
        "dataset_sha256": sha256(Path(data_path).read_bytes()),
        "sources": {
            name: sha256((ROOT / name).read_bytes())
            for name in (RULES, MATCHER, ADAPTERS, TEMPLATE)
        },
    }
    return out.replace(
        "// ==/UserScript==",
        "// ==/UserScript==\n// PSU_BUILD " + json.dumps(provenance, sort_keys=True),
        1,
    )


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--data", type=Path, default=DATA)
    parser.add_argument("--output", type=Path, default=ROOT / OUTPUT)
    parser.add_argument("--test", action="store_true")
    args = parser.parse_args()

    out = build(args.data)
    with open(args.output, "w", encoding="utf-8", newline="\n") as f:
        f.write(out)
    print(f"Generated {OUTPUT} ({len(out)} bytes)")

    if args.test:
        with open(args.data, encoding="utf-8") as f:
            data_raw = f.read()
        with open("psu_data_var.js", "w", encoding="utf-8") as f:
            f.write(f"window.psuData = {data_raw};")
        print("Generated test artifact: psu_data_var.js")


if __name__ == "__main__":
    main()
