/*
 * Turn manually-saved Tweakers pages (Ctrl-S) into tools/tweakers_seed.json.
 *
 * No network: you save the Pricewatch listing/comparison pages from your
 * browser, drop the .html files in tools/saved-tweakers/ (or pass paths as
 * args), and this extracts { id, name, wattage, efficiency, modular } per
 * product using the SAME src/adapters.js the userscript uses. Results are
 * merged and de-duped by Pricewatch id, then gen_tweakers_css.cjs builds the CSS.
 *
 *   1. Save pages  ->  tools/saved-tweakers/*.html
 *   2. node tools/parse_tweakers_html.cjs
 *   3. node tools/gen_tweakers_css.cjs
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { parseHTML } = require('linkedom');

const root = path.join(__dirname, '..');
const savedDir = path.join(__dirname, 'saved-tweakers');

// Files: CLI args if given, else everything in tools/saved-tweakers/.
let files = process.argv.slice(2);
if (!files.length) {
  if (!fs.existsSync(savedDir)) {
    fs.mkdirSync(savedDir, { recursive: true });
    process.stderr.write(`Created ${path.relative(root, savedDir)} — save Tweakers pages there, then re-run.\n`);
    process.exit(0);
  }
  files = fs.readdirSync(savedDir)
    .filter((f) => /\.html?$/i.test(f))
    .map((f) => path.join(savedDir, f));
}
if (!files.length) {
  process.stderr.write('No .html files found. Save Tweakers pages into tools/saved-tweakers/ first.\n');
  process.exit(0);
}

function loadAdapter(html) {
  // Match what tests/test_adapters.js does: fake location + global document,
  // then load the real adapter fresh.
  global.location = /** @type {any} */ ({ hostname: 'tweakers.net', pathname: '/voedingen/vergelijken/' });
  const { document } = parseHTML(html.indexOf('<html') !== -1 ? html : `<!doctype html><html><body>${html}</body></html>`);
  global.document = document;
  delete require.cache[require.resolve('../src/adapters.js')];
  const { activeAdapter } = require('../src/adapters.js');
  return { adapter: activeAdapter(), document };
}

const PRICEWATCH = /\/pricewatch\/(\d+)\//;
const byId = new Map();

for (const file of files) {
  const html = fs.readFileSync(file, 'utf8');
  const { adapter, document } = loadAdapter(html);
  if (!adapter || adapter.id !== 'tweakers') {
    process.stderr.write(`  ${path.basename(file)}: tweakers adapter not active, skipping\n`);
    continue;
  }
  const rows = [...document.querySelectorAll(adapter.selector)];
  let found = 0;
  for (const row of rows) {
    const link = row.querySelector('a.editionName, .productListItemName a, a[href*="/pricewatch/"]');
    const href = link && (link.getAttribute('href') || '');
    const m = href && href.match(PRICEWATCH);
    if (!m) continue;
    const data = adapter.extract(row);
    if (!data || !data.name) continue;
    const id = m[1];
    // Keep the richest record if the same product appears on several pages.
    const prev = byId.get(id);
    const rec = {
      id,
      name: data.name,
      wattage: data.wattage || (prev && prev.wattage) || 0,
      efficiency: data.efficiency || (prev && prev.efficiency) || null,
      modular: data.modular || (prev && prev.modular) || null,
      formFactor: data.formFactor || (prev && prev.formFactor) || null
    };
    byId.set(id, rec);
    found++;
  }
  process.stderr.write(`  ${path.basename(file)}: ${found} product rows\n`);
}

const seed = [...byId.values()].sort((a, b) => a.name.localeCompare(b.name));
const outFile = path.join(__dirname, 'tweakers_seed.json');
fs.writeFileSync(outFile, JSON.stringify(seed, null, 2) + '\n');
process.stderr.write(`\n${seed.length} unique products -> ${path.relative(root, outFile)}\n`);
