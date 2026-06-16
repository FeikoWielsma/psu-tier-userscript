# Tweakers custom-CSS generator

Generates a **static stylesheet** that injects PSU tier badges into the Tweakers
Pricewatch listing using Tweakers' built-in *Custom CSS* setting — no extension,
no userscript manager. It reuses `src/matcher.js` and `src/adapters.js`
verbatim, so a generated badge means exactly what an in-page userscript badge
would mean.

It's a static snapshot of one moment in the catalogue: new products or tier-list
changes need a regenerate-and-repaste. Pure CSS can't fuzzy-match at runtime, so
this trades the userscript's live matching for zero-install convenience.

## Workflow

```
saved Pricewatch pages ──parse_tweakers_html.cjs──► tools/tweakers_seed.json
   (manual Ctrl-S, no crawl)   (reuses src/adapters.js)        │
                                            gen_tweakers_css.cjs (reuses src/matcher.js)
                                                                │
                                                  dist-tweakers/tweakers.<variant>.css
```

1. **Save the listing pages.** Open
   `https://tweakers.net/voedingen/vergelijken/`, page through it, and Ctrl-S
   each page ("HTML only" is fine) into `tools/saved-tweakers/`. Manual saves
   keep all load off Tweakers — no automated crawl.

2. **Parse → seed.** Extracts `{ id, name, wattage, efficiency, modular }` per
   product (via `src/adapters.js`), de-duped by Pricewatch id:
   ```bash
   node tools/parse_tweakers_html.cjs            # reads tools/saved-tweakers/*.html
   # or pass explicit paths: node tools/parse_tweakers_html.cjs path/to/*.html
   ```

3. **Generate.** Runs the matcher over the seed and emits CSS into
   `dist-tweakers/`:
   ```bash
   node tools/gen_tweakers_css.cjs               # boxed pills (default), ~36 KB, 1 entry
   node tools/gen_tweakers_css.cjs --lite        # coloured tier letter only, ~36 KB
   node tools/gen_tweakers_css.cjs --popup --split  # pills + hover popups, 15 entries
   ```

4. **Paste** the file(s) into Tweakers → *Voorkeuren* → *Custom CSS*.

## How it fits

Tweakers stores each custom-CSS entry in a 65535-byte (`2^16-1`) field but
allows several entries.

- **boxed / lite** group products by tier so the `content`+colour declaration is
  written once per tier and each product costs only its ~35-byte selector line —
  all ~900 PSUs fit in **one** entry.
- **popup** bakes a per-product spec panel into a `::before` `content` string
  (with `\A` newlines). Each is unique, so it can't be grouped; `--split` chunks
  it into ≤63 KB parts at whole-rule boundaries. Chips are emitted first so a
  too-small entry keeps the chips and only drops popups.

Key selector details (learned the hard way):

- Scope to `a.editionName` — the row's *title* link. An unscoped
  `a[href*="/<id>/"]` also matches the thumbnail, review-count, price and rating
  links, stamping a chip on each.
- The popup is anchored to the row `li:has(a.editionName[href*="/<id>/"])`, not
  the title link: the title lives in a `span.title.ellipsis` whose
  `overflow:hidden` clips anything hanging below it.

Preview locally without Tweakers: open `dist-tweakers/demo.html`.
