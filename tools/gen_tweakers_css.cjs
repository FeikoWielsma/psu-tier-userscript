/*
 * Turn the live matcher's output into a *static* Tweakers custom-CSS stylesheet.
 * Each product becomes a tier chip (::after); the popup variant adds a hover
 * spec panel (::before) baked into one `content` string. No JS runs on Tweakers
 * - it's pure CSS. Reuses src/matcher.js verbatim (the same engine the
 * userscript ships), so a generated badge means exactly what an in-page badge
 * would mean.
 *
 * Input:  tools/tweakers_seed.json  [{ id, name, wattage, efficiency, modular, formFactor }]
 * Output: dist-tweakers/tweakers.<variant>.css   (+ a match summary on stderr)
 *
 * Variants (Tweakers caps each custom-CSS entry at 65535 bytes, but allows
 * several entries):
 *   (default)  boxed  - filled pill chips, tier-grouped, ~36 KB, ONE entry
 *   --lite            - coloured tier letter only, ~36 KB, ONE entry
 *   --popup           - pill chips + hover spec popups; large, use with --split
 *   --split           - chunk output into <=63 KB parts at rule boundaries
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { buildIndex, match } = require('../src/matcher.js');

const root = path.join(__dirname, '..');
const psuData = JSON.parse(fs.readFileSync(path.join(root, 'psu_data.json'), 'utf8'));
const rules = JSON.parse(fs.readFileSync(path.join(root, 'data', 'normalization_rules.json'), 'utf8'));
const seed = JSON.parse(fs.readFileSync(path.join(__dirname, 'tweakers_seed.json'), 'utf8'));
const index = buildIndex(psuData, rules);

// Tier badge palette + styling mirrored from the real userscript
// (src/userscript.template.js: TIER_STYLES + makeBadge) so the CSS badges look
// identical to the extension. Keyed on the leading letter (+/- shade ignored).
function tierStyle(tier) {
  const k = String(tier || '').replace(/[+-]/g, '').toUpperCase();
  return ({
    A: { bg: '#00ebb9', fg: '#000' },
    B: { bg: '#a4de9a', fg: '#000' },
    C: { bg: '#ffd966', fg: '#000' },
    D: { bg: '#f29738', fg: '#000' },
    E: { bg: '#e06666', fg: '#fff' },
    F: { bg: '#ff4f4f', fg: '#fff' }
  })[k] || { bg: '#333', fg: '#fff' };
}

// Shared (tier-independent) chip box styling - written once in boxed mode.
const CHIP_COMMON = 'display:inline-block;vertical-align:middle;margin-left:8px;padding:2px 6px;border-radius:4px;font-size:.8em;font-weight:bold';

// Badge text: "Tier B", "Tier B+ (LC)" for limited, trailing "?" for likely.
function chipText(it) {
  return `Tier ${it.tier}${it.limited ? '* (LC)' : ''}${it.dashed ? '?' : ''}`;
}

// The tier-specific declarations (no braces): colours, the gold ring on "+"
// tiers, dotted border + red ring for limited, dashed border + dimmed for
// likely - exactly as makeBadge() sets them inline.
function chipVisual(it) {
  const s = tierStyle(it.tier);
  const plus = String(it.tier).includes('+');
  const border = it.limited ? '2px dotted #000' : (it.dashed ? '2px dashed #555' : '0');
  const shadow = it.limited ? '0 0 0 2px #ff4f4f' : (plus ? '0 0 0 2px gold' : 'none');
  const opacity = (it.dashed || it.limited) ? '.85' : '1';
  return `content:"${cssStr(chipText(it))}";background:${s.bg};color:${s.fg};border:${border};box-shadow:${shadow};opacity:${opacity}`;
}

// Escape a string for use inside a CSS `content: "..."` literal.
function cssStr(s) {
  return String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}
const NL = '\\A ';                          // CSS newline inside content

function specLine(e) {
  return [e.wattage, e.efficiency, e.form_factor, e.atx_version,
    e.modularity && e.modularity !== 'No' ? e.modularity + ' modular' : (e.modularity === 'No' ? 'Non-modular' : null)]
    .filter(Boolean).join('  ·  ');
}

function popupBody(p, res) {
  const e = res.entry;
  const pct = Math.round(res.confidence * 100);
  const band = res.band === 'strong' ? 'confident' : 'likely';
  const lines = [
    p.name,
    '',
    `Tier ${e.tier}   ·   ${pct}% (${band})`,
    specLine(e),
  ];
  if (e.odm || e.platform) lines.push(`ODM ${e.odm || '?'}  ·  ${e.platform || '?'}`);
  if (res.alternates && res.alternates.length) {
    lines.push('');
    lines.push('Other possible matches:');
    for (const a of res.alternates) {
      lines.push(` · ${a.entry.brand} ${a.entry.model} ${a.entry.wattage} → ${a.entry.tier} (${Math.round(a.confidence * 100)}%)`);
    }
  }
  return lines.map(cssStr).join(NL);
}

// ---- chip emitter (default boxed, or --lite) ----------------------------
//
// Scope to the product *title* link only. A listing row links to the same
// product from the thumbnail, title, review count, price and rating stars - an
// unscoped a[href*=...] stamps a chip on every one. `.editionName` is the title
// anchor (same one src/adapters.js extracts from). The id alone is unique on
// pricewatch URLs, so [href*="/<id>/"] is enough.
//
// Products are grouped by (tier, dashed): everyone in a group shares the exact
// same `content` (tier letter) and colour, so the declaration is written ONCE
// per group and each product costs only its ~35-byte selector line. That keeps
// all ~900 PSUs inside a single 64 KB entry.
//   box=false -> coloured tier letter (lite)
//   box=true  -> filled pill chip (boxed)
function buildTierGrouped(items, box) {
  const shared = box
    ? `.editionName::after{${CHIP_COMMON}}`
    : '.editionName::after{margin-left:5px;font-weight:700;font-size:.85em}';
  // Group by every styling-relevant axis so each group shares one declaration.
  const groups = new Map(); // key -> { rep, ids[] }
  for (const it of items) {
    const key = `${it.tier}|${it.limited ? 1 : 0}|${it.dashed ? 1 : 0}`;
    const g = groups.get(key) || groups.set(key, { rep: it, ids: [] }).get(key);
    g.ids.push(it.id);
  }
  // Returns an array of whole rules; the first is the shared styling rule.
  const out = [shared];
  for (const g of groups.values()) {
    const selectors = g.ids.map((id) => `.editionName[href*="/${id}/"]::after`).join(',\n');
    const decl = box
      ? `{${chipVisual(g.rep)}}`
      : `{content:" ${cssStr(g.rep.tier + (g.rep.limited ? '*' : '') + (g.rep.dashed ? '?' : ''))}";color:${tierStyle(g.rep.tier).bg}}`;
    out.push(`${selectors}\n${decl}`);
  }
  return out;
}

// ---- popup emitter (--popup) --------------------------------------------
//
// Self-contained one-block-per-product: a boxed chip plus a hover spec popup.
// The popup is anchored to the row <li> via :has(), not the title link: the
// title sits in a `span.title.ellipsis` (overflow:hidden) that would clip
// anything hanging below it. Each product's popup `content` is unique, so these
// can't be tier-grouped - the output is large and meant to be --split across
// several entries. Chips come first so a too-small entry keeps chips, not popups.
function buildPopup(items) {
  const chipRule = (it) => `.editionName[href*="/${it.id}/"]::after{${CHIP_COMMON};${chipVisual(it)}}`;
  const popupRules = (it) => {
    const row = `li:has(a.editionName[href*="/${it.id}/"])`;
    return [
      `${row}{position:relative}`,
      `${row}::before{content:"${it.popup}";white-space:pre;font-family:monospace;position:absolute;top:1.6em;left:220px;z-index:99999;background:#15171a;color:#e6e6e6;border:1px solid ${it.color};border-radius:6px;padding:8px 11px;font-size:.8em;line-height:1.45;width:max-content;max-width:520px;box-shadow:0 6px 22px rgba(0,0,0,.45);opacity:0;visibility:hidden;pointer-events:none;transition:opacity .12s}`,
      `${row}:hover::before{opacity:1;visibility:visible}`
    ].join('\n');
  };
  // Array of whole rules: all chips first (small), then one popup block each.
  return [...items.map(chipRule), '/* ---- hover popups ---- */', ...items.map(popupRules)];
}

// ---- build --------------------------------------------------------------

const items = [];
let matched = 0;
for (const p of seed) {
  const res = match(p.name, { wattage: p.wattage, efficiency: p.efficiency, modular: p.modular, formFactor: p.formFactor }, index);
  if (!res) continue;
  matched++;
  const dashed = res.band !== 'strong';
  items.push({
    id: p.id,
    tier: res.entry.tier,
    limited: !!res.entry.is_limited,
    color: tierStyle(res.entry.tier).bg, // accent for the popup border
    dashed,
    popup: popupBody(p, res)
  });
}

const lite = process.argv.includes('--lite');
const popup = process.argv.includes('--popup');
const variant = popup ? 'popup' : (lite ? 'lite' : 'boxed');
const ruleList = popup ? buildPopup(items) : buildTierGrouped(items, !lite); // array of whole rules
const header = '/* PSU Tier List -> Tweakers custom CSS (generated). Static snapshot; regenerate to refresh. */\n';

// Dutch description carried with the snippet so it explains itself when shared.
// Kept verbatim (and under 1024 chars) to double as the Tweakers description field.
const banner = `/*
Zet bij elke voeding in de Tweakers Pricewatch automatisch een gekleurde tier-badge uit SPL's PSU Tier List.
Zo zie je in een oogopslag of een voeding goed is (Tier A, groen) of beter te vermijden (Tier E/F, rood).

Geen browserextensie of userscript-manager nodig: vinkje aan en herlaad de Pricewatch.

Tekens op de badge:
  "?"  = waarschijnlijke, maar onzekere match
  "* (LC)" = speculatieve rating (limited confidence)

Let op: dit is een statische momentopname van de tierlijst.
Nieuwe voedingen of wijzigingen verschijnen pas in een nieuwere versie.
De badges zijn een hulpmiddel - twijfel je, controleer dan altijd de officiele lijst.
Ik ben ook lui en doe vaak dingen laat en of/niet

Wil je meer (ook op PCPartPicker, plus een klikbare pop-up met specs en
confidence)? Er is ook een volledige userscript/extensie met toeters en bellen.

Vragen, bugs of een verkeerde match melden? Zie GitHub, of DM hiero:

https://github.com/FeikoWielsma/psu-tier-userscript
*/
`;

const outDir = path.join(root, 'dist-tweakers');
fs.mkdirSync(outDir, { recursive: true });

// --split: chunk into <=CAP parts on whole-rule boundaries (never mid-rule).
// Grouped variants put a shared styling rule first that every part needs, so
// it's pulled out as a repeated preamble.
const CAP = 63000; // headroom under the 65535-byte per-entry cap
if (process.argv.includes('--split')) {
  const preamble = popup ? '' : ruleList[0] + '\n';
  const rest = popup ? ruleList : ruleList.slice(1);
  const parts = [];
  let buf = '';
  for (const r of rest) {
    const piece = r + '\n';
    if (buf && Buffer.byteLength(header + preamble + buf + piece) > CAP) { parts.push(buf); buf = ''; }
    buf += piece;
  }
  if (buf) parts.push(buf);
  parts.forEach((p, i) => {
    const f = path.join(outDir, `tweakers.${variant}.part${String(i + 1).padStart(2, '0')}.css`);
    fs.writeFileSync(f, `${i === 0 ? banner : ''}${header}/* part ${i + 1}/${parts.length} */\n${preamble}${p}`);
  });
  process.stderr.write(`${matched}/${seed.length} matched -> ${parts.length} part(s) (tweakers.${variant}.partNN.css), <=${(CAP / 1024).toFixed(0)} KB each\n`);
} else {
  const outFile = path.join(outDir, `tweakers.${variant}.css`);
  fs.writeFileSync(outFile, banner + header + ruleList.join('\n') + '\n');
  process.stderr.write(`${matched}/${seed.length} matched -> ${path.relative(root, outFile)} (${(fs.statSync(outFile).size / 1024).toFixed(0)} KB)\n`);
}
