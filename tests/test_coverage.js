/*
 * Real-corpus regression test. Runs the matcher over a deduplicated set of
 * ~900 real product names scraped from saved PCPartPicker listing pages
 * (tests/fixtures/pcpp-products.json) against the committed data snapshot.
 *
 * It does NOT assert a tier per product (that needs manual labelling - see the
 * "pcpp" cases in corpus.json for those). It guards against exceptions and
 * reports coverage descriptively. Correctness gates use reviewed identities.
 * A full PCPartPicker listing includes many genuinely unrated budget/old units,
 * so 100% is neither expected nor desirable.
 */
const fs = require('fs');
const path = require('path');
const { buildIndex, match } = require('../src/matcher.js');

const root = path.join(__dirname, '..');
const { loadDataset } = require('./helpers.js');
const { data, file, sha256 } = loadDataset();
const rules = JSON.parse(fs.readFileSync(path.join(root, 'data/normalization_rules.json'), 'utf8'));
const products = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/pcpp-products.json'), 'utf8'));

const index = buildIndex(data, rules);

let matched = 0;
let strong = 0;
let errors = 0;
for (const product of products) {
    try {
        const r = match(product.name, product, index, rules);
        if (r) { matched++; if (r.band === 'strong') strong++; }
    } catch (e) {
        errors++;
        console.log(`  ERROR on "${product.name}": ${e.message}`);
    }
}

const coverage = matched / products.length;
console.log(`Dataset: ${file}\nSHA256: ${sha256}`);
console.log('Real-corpus coverage (informational, not accuracy)\n');
console.log(`  products: ${products.length}`);
console.log(`  matched:  ${matched} (${(coverage * 100).toFixed(1)}%), of which strong: ${strong}`);
console.log(`  errors:   ${errors}`);


let failures = 0;
if (errors > 0) { failures++; console.log(`\nFAIL: matcher threw on ${errors} product(s).`); }

if (failures) process.exit(1);
console.log('\nReal-corpus coverage test passed.');
