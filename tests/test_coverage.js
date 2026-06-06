/*
 * Real-corpus regression test. Runs the matcher over a deduplicated set of
 * ~900 real product names scraped from saved PCPartPicker listing pages
 * (tests/fixtures/pcpp-products.json) against the committed data snapshot.
 *
 * It does NOT assert a tier per product (that needs manual labelling - see the
 * "pcpp" cases in corpus.json for those). Instead it guards two things:
 *   - the matcher never throws on real-world input, and
 *   - overall match coverage doesn't regress below a floor.
 * A full PCPartPicker listing includes many genuinely unrated budget/old units,
 * so 100% is neither expected nor desirable.
 */
const fs = require('fs');
const path = require('path');
const { buildIndex, match } = require('../src/matcher.js');

const root = path.join(__dirname, '..');
const data = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/sample_psu_data.json'), 'utf8'));
const rules = JSON.parse(fs.readFileSync(path.join(root, 'data/normalization_rules.json'), 'utf8'));
const products = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/pcpp-products.json'), 'utf8'));

const COVERAGE_FLOOR = 0.72; // matched / total; current ~0.77 (structured signals
// trade a little raw coverage for precision - they reject wrong-efficiency and
// wrong-form-factor matches that name-only matching let through).

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
console.log('Real-corpus coverage test\n');
console.log(`  products: ${products.length}`);
console.log(`  matched:  ${matched} (${(coverage * 100).toFixed(1)}%), of which strong: ${strong}`);
console.log(`  errors:   ${errors}`);
console.log(`  floor:    ${(COVERAGE_FLOOR * 100).toFixed(0)}%`);

let failures = 0;
if (errors > 0) { failures++; console.log(`\nFAIL: matcher threw on ${errors} product(s).`); }
if (coverage < COVERAGE_FLOOR) {
    failures++;
    console.log(`\nFAIL: coverage ${(coverage * 100).toFixed(1)}% dropped below floor ${(COVERAGE_FLOOR * 100).toFixed(0)}%.`);
}

if (failures) process.exit(1);
console.log('\nReal-corpus coverage test passed.');
