/*
 * Matching tests. Runs the REAL matcher (src/matcher.js) against a corpus of
 * product names, using a committed data snapshot so results are deterministic
 * in CI (independent of live sheet edits). No network access.
 */
const fs = require('fs');
const path = require('path');
const { buildIndex, match } = require('../src/matcher.js');

const root = path.join(__dirname, '..');
const data = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/sample_psu_data.json'), 'utf8'));
const rules = JSON.parse(fs.readFileSync(path.join(root, 'data/normalization_rules.json'), 'utf8'));
const corpus = JSON.parse(fs.readFileSync(path.join(__dirname, 'corpus.json'), 'utf8'));

const index = buildIndex(data, rules);
const BAND_RANK = { likely: 1, strong: 2 };

let failures = 0;
console.log(`Matching tests (${corpus.length} cases, ${data.length} PSU entries)\n`);

for (const tc of corpus) {
    const signals = { wattage: tc.wattage, efficiency: tc.efficiency, formFactor: tc.formFactor };
    const result = match(tc.name, signals, index, rules);
    const expected = tc.expectTier;
    const tier = result ? result.entry.tier : null;

    let ok;
    if (expected === null) {
        ok = result === null;
    } else {
        const allowed = Array.isArray(expected) ? expected : [expected];
        ok = result !== null && allowed.includes(tier);
        if (ok && tc.minBand) ok = BAND_RANK[result.band] >= BAND_RANK[tc.minBand];
        if (ok && tc.expectLimited !== undefined) {
            ok = !!result.entry.is_limited === tc.expectLimited;
        }
    }

    if (ok) {
        const detail = result
            ? `Tier ${tier} (${Math.round(result.confidence * 100)}% ${result.band})`
            : 'no match';
        console.log(`  PASS  ${tc.name}  ->  ${detail}`);
    } else {
        failures++;
        const got = result
            ? `Tier ${tier} (${Math.round(result.confidence * 100)}% ${result.band}) [${result.entry.model}]`
            : 'no match';
        console.log(`  FAIL  ${tc.name}`);
        console.log(`        expected ${JSON.stringify(expected)}${tc.minBand ? ' (>=' + tc.minBand + ')' : ''}, got ${got}`);
    }
}

if (failures) {
    console.log(`\n${failures}/${corpus.length} failed.`);
    process.exit(1);
}
console.log(`\nAll ${corpus.length} matching tests passed.`);
