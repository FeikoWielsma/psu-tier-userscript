// Deliberately break three safety decisions in memory and prove public-behavior
// assertions detect each regression. Never edit the real source or artifacts.
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'src/matcher.js'), 'utf8');
const rules = JSON.parse(fs.readFileSync(path.join(root, 'data/normalization_rules.json'), 'utf8'));
const mutations = [
    { name: 'generation rejection', before: 'function qualifierEvidence(product, candidate, entry) {',
        after: 'function qualifierEvidence(product, candidate, entry) { return { uncertain: false };',
        verify: (matcher) => assert.equal(matcher.match('Example Alpha V3', { wattage: 850 }, matcher.buildIndex([
            { brand: 'Example', model: 'Alpha', wattage: '850W', tier: 'A' }
        ], rules)), null) },
    { name: 'ambiguity downgrade', before: 'const ambiguous = best.uncertain || rivals.length > 0;',
        after: 'const ambiguous = false;',
        verify: (matcher) => assert.equal(matcher.match('Example Alpha', { wattage: 850 }, matcher.buildIndex([
            { brand: 'Example', model: 'Alpha V2', wattage: '850W', tier: 'A' }
        ], rules)).band, 'likely') },
    { name: 'wattage rejection', before: 'if (!wattageOk(entry.wattage, productWattage)) continue;',
        after: 'if (false) continue;',
        verify: (matcher) => assert.equal(matcher.match('Example Alpha', { wattage: 850 }, matcher.buildIndex([
            { brand: 'Example', model: 'Alpha', wattage: '650W', tier: 'A' }
        ], rules)), null) }
];
function load(text) {
    const context = { module: { exports: {} } };
    vm.runInNewContext(text, context, { timeout: 1000 });
    return context.module.exports;
}
for (const mutation of mutations) {
    mutation.verify(load(source));
    assert.equal(source.split(mutation.before).length, 2, `Mutation target changed: ${mutation.name}`);
    const mutant = load(source.replace(mutation.before, mutation.after));
    assert.throws(() => mutation.verify(mutant), assert.AssertionError, `Undetected mutation: ${mutation.name}`);
    console.log(`Detected disabled ${mutation.name}`);
}
