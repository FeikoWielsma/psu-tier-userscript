const { test } = require('node:test');
const assert = require('node:assert/strict');
const { buildIndex, match, wattageOk } = require('../src/matcher.js');
const { readJson, root, loadDataset, assertMatch, validateCase, validateData } = require('./helpers.js');
const rules = readJson(`${root}/data/normalization_rules.json`);
const entry = (model, extra = {}) => ({ brand: 'Example', model, tier: 'A', wattage: '850W', ...extra });
const run = (name, rows, signals = {}, customRules = rules) => match(name, { wattage: 850, ...signals }, buildIndex(rows, customRules));

for (const qualifier of ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'V2', 'V3', 'X2', '2027', 'rev. 2.0']) {
    test(`explicit unknown ${qualifier} cannot match base model`, () => {
        assert.equal(run(`Example Alpha ${qualifier}`, [entry('Alpha')]), null);
    });
    test(`explicit known ${qualifier} matches exact identity`, () => {
        const result = run(`Example Alpha ${qualifier}`, [entry('Alpha'), entry(`Alpha ${qualifier}`)]);
        assert.equal(result.entry.model, `Alpha ${qualifier}`);
        assert.equal(result.band, 'strong');
        assert.equal(result.alternates.length, 0);
    });
}

test('reported MSI generation regression with only one candidate', () => {
    const rows = [{ brand: 'MSI', model: 'MAG A-GL PCIE5', wattage: '850W', tier: 'B' }];
    assert.equal(match('MSI MAG A850GL PCIE5 III', { wattage: 850 }, buildIndex(rows, rules)), null);
});

test('unknown generation cannot escape through constraint matching', () => {
    const restrictive = { ...rules, thresholds: { ...rules.thresholds, minProductCoverage: 1.1 } };
    assert.equal(run('Example C III', [entry('C II', { efficiency: '80+ Gold' })], { efficiency: 'Gold' }, restrictive), null);
});

test('missing generation remains likely even with one possible generation', () => {
    assert.equal(run('Example Alpha', [entry('Alpha V2')]).band, 'likely');
});

test('standard versions do not become product generations', () => {
    assert.ok(run('Example Alpha ATX 3.1 PCIe 5.0 Gen 5', [entry('Alpha')]));
});

test('same-tier identities remain ambiguous and independent of sheet order', () => {
    const rows = [entry('Alpha', { year: '2020' }), entry('Alpha', { year: '2024' })];
    const a = run('Example Alpha', rows);
    assert.equal(a.band, 'likely');
    assert.equal(a.ambiguous, true);
    assert.equal(a.contested, false);
    assert.deepEqual(a, run('Example Alpha', rows.slice().reverse()));
});

test('different-tier ambiguity is stable', () => {
    const rows = [entry('Alpha', { tier: 'C' }), entry('Alpha', { tier: 'A' })];
    const a = run('Example Alpha', rows);
    assert.equal(a.contested, true);
    assert.equal(a.band, 'likely');
    assert.deepEqual(a, run('Example Alpha', rows.slice().reverse()));
});

test('all ambiguous candidates survive even when there are more than three alternates', () => {
    const rows = Array.from({ length: 6 }, (_, i) => entry('Alpha', { year: String(2020 + i) }));
    assert.equal(run('Example Alpha', rows).alternates.length, 5);
});

test('duplicate sheet rows do not manufacture ambiguity', () => {
    assert.equal(run('Example Alpha', [entry('Alpha'), entry('Alpha')]).band, 'strong');
});

test('same-tier model errors and forbidden alternates fail the harness', () => {
    const result = run('Example Alpha', [entry('Alpha')]);
    assert.throws(() => assertMatch({ name: 'Example Alpha', expectTier: 'A', expectModel: 'Beta' }, result));
    assert.throws(() => assertMatch({ name: 'Example Alpha', expectTier: 'A', forbidModels: ['Alpha'] }, result));
});

test('invalid expectations and malformed datasets fail loudly', () => {
    for (const tc of [
        { name: 'Alpha', expectTier: 'A', expectModle: 'Alpha' },
        { name: 'Alpha', expectTier: 'A', maxBand: 'certain' },
        { name: 'Alpha', expectTier: null, minBand: 'strong' },
        { name: 'Alpha', expectTier: [] }
    ]) assert.throws(() => validateCase(tc));
    assert.throws(() => validateData([]));
    assert.throws(() => validateData([{ brand: 'Example', model: 'Alpha', tier: '?' }]));
});

test('wattage lists and ranges reject other wattages', () => {
    assert.ok(wattageOk('750/850W', 850));
    assert.ok(wattageOk('750-1000W', 900));
    assert.equal(wattageOk('750/850W', 900), false);
    assert.equal(wattageOk('750-1000W', 1100), false);
    assert.equal(wattageOk('850W', 845), false);
    assert.ok(wattageOk('750-850/1000W', 800));
    assert.ok(wattageOk('750-850/1000W', 1000));
    assert.equal(wattageOk('750-850/1000W', 900), false);
});

test('structured conflicts reject candidates while dual grades remain usable', () => {
    const row = entry('Alpha', { form_factor: 'ATX', modularity: 'Full', efficiency: '80+ Gold' });
    assert.equal(run('Example Alpha', [row], { formFactor: 'SFX' }), null);
    assert.equal(run('Example Alpha', [row], { modular: 'No' }), null);
    assert.ok(run('Example Alpha', [row], { efficiency: 'Gold, Platinum' }));
});

test('formatting variations preserve a unique identity', () => {
    for (const name of ['Example Alpha II', 'EXAMPLE alpha ii', 'Example  Alpha  II', 'Example Alpha-II']) {
        assert.equal(run(name, [entry('Alpha II')]).entry.model, 'Alpha II');
    }
});

test('name aliases cannot erase an explicit conflicting generation', () => {
    const data = loadDataset().data;
    assert.equal(match('Seasonic Focus GX V99 (2024)', { wattage: 850 }, buildIndex(data, rules)), null);
    assert.equal(match('Seasonic Focus GX V3 (2024)', { wattage: 850 }, buildIndex(data, rules)), null);
});

test('brand-wide sheet ratings require a PSU wattage signal', () => {
    const data = [entry('All PSUs', { wattage: null })];
    assert.equal(run('Example Alpha V99', data).band, 'likely');
    assert.equal(run('Example Monitor', data, { wattage: 0 }), null);
});

test('distinct small form factors cannot substitute for one another', () => {
    assert.equal(run('Example Alpha', [entry('Alpha', { form_factor: 'TFX' })], { formFactor: 'SFX' }), null);
    assert.equal(run('Example Alpha', [entry('Alpha', { form_factor: 'Flex ATX' })], { formFactor: 'SFX' }), null);
});

test('unknown model suffixes and contradictory certifications are rejected', () => {
    assert.equal(run('Example Alpha ZX', [entry('Alpha')]), null);
    assert.equal(run('Example Alpha', [entry('Alpha', { efficiency: '80+ Gold' })], { efficiency: '80+ Bronze' }), null);
});

test('the full saved corpus is invariant under candidate permutation', () => {
    const data = loadDataset().data;
    const products = readJson(`${__dirname}/fixtures/pcpp-products.json`);
    const normal = buildIndex(data, rules);
    const reversed = buildIndex(data.slice().reverse(), rules);
    const shuffled = data.map((psu, i) => ({ entry: psu, key: ((i + 17) * 2654435761) >>> 0 }))
        .sort((a, b) => a.key - b.key).map((pair) => pair.entry);
    const other = buildIndex(shuffled, rules);
    for (const product of products) {
        const expected = match(product.name, product, normal);
        assert.deepEqual(match(product.name, product, reversed), expected, product.name);
        assert.deepEqual(match(product.name, product, other), expected, product.name);
    }
});
