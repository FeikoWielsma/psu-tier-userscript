"""Assemble psutier.user.js from the template, matcher, data and rules.

The userscript is built by substituting three placeholders in
src/userscript.template.js:
  /*__PSU_DATA__*/  -> the parsed tier-list entries (psu_data.json)
  /*__RULES__*/     -> data/normalization_rules.json
  /*__MATCHER__*/   -> src/matcher.js verbatim (single source of truth)

Flags:
  --update   fetch + parse the latest sheet first
  --test     also emit psu_data_var.js for the Node test harness
"""

import json
import sys

import fetch_sheet
import parse_tier_list

TEMPLATE = "src/userscript.template.js"
MATCHER = "src/matcher.js"
ADAPTERS = "src/adapters.js"
DATA = "psu_data.json"
RULES = "data/normalization_rules.json"
OUTPUT = "psutier.user.js"


def js_safe(json_str):
    """Escape characters that could break out of a JS context.

    JSON permits raw ``<``/``>``/``&`` and the U+2028/U+2029 line separators;
    the former are an injection risk and the latter terminate JS string
    literals, so escape all of them.
    """
    return (json_str
            .replace("<", "\\u003c")
            .replace(">", "\\u003e")
            .replace("&", "\\u0026")
            .replace(chr(0x2028), "\\u2028")
            .replace(chr(0x2029), "\\u2029"))


def _indent(text, spaces):
    pad = " " * spaces
    return "\n".join(pad + line if line.strip() else line
                     for line in text.splitlines())


def build():
    with open(DATA, encoding="utf-8") as f:
        data = json.load(f)
    with open(RULES, encoding="utf-8") as f:
        rules = json.load(f)
    with open(MATCHER, encoding="utf-8") as f:
        matcher_src = f.read()
    with open(ADAPTERS, encoding="utf-8") as f:
        adapters_src = f.read()
    with open(TEMPLATE, encoding="utf-8") as f:
        template = f.read()

    data_json = js_safe(json.dumps(data, ensure_ascii=False))
    rules_json = js_safe(json.dumps(rules, ensure_ascii=False))

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
    return out


def main():
    if "--update" in sys.argv:
        print("Fetching and parsing latest tier list...")
        fetch_sheet.main()
        parse_tier_list.main()

    out = build()
    with open(OUTPUT, "w", encoding="utf-8") as f:
        f.write(out)
    print(f"Generated {OUTPUT} ({len(out)} bytes)")

    if "--test" in sys.argv:
        with open(DATA, encoding="utf-8") as f:
            data_raw = f.read()
        with open("psu_data_var.js", "w", encoding="utf-8") as f:
            f.write(f"window.psuData = {data_raw};")
        print("Generated test artifact: psu_data_var.js")


if __name__ == "__main__":
    main()
