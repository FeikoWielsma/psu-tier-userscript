const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');

const root = path.resolve(__dirname, '..');
const BAND_RANK = { likely: 1, strong: 2 };
const identityFields = ['brand', 'model', 'wattage', 'year', 'form_factor', 'efficiency', 'modularity', 'input_range', 'tier', 'is_limited'];
const caseFields = new Set(['name', 'wattage', 'efficiency', 'efficiencyNote', 'formFactor', 'modular',
    'site', 'note', 'expectTier', 'expectModel', 'expectIdentity', 'forbidModels', 'minBand', 'maxBand',
    'expectLimited', 'expectContested', 'expectAmbiguous']);

function readJson(file) {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function validateRules(rules) {
    for (const field of ['aliases', 'strip']) {
        assert.ok(Array.isArray(rules[field]), `Rules require ${field}`);
        for (const rule of rules[field]) {
            assert.equal(typeof rule.pattern, 'string');
            assert.equal(typeof rule.replace, 'string');
            new RegExp(rule.pattern, rule.flags || '');
        }
    }
    for (const field of ['noise', 'generic']) {
        assert.ok(Array.isArray(rules[field]));
        rules[field].forEach((word) => assert.equal(typeof word, 'string'));
    }
    for (const field of ['strong', 'likely', 'floor', 'minProductCoverage', 'ambiguousGap']) {
        assert.ok(Number.isFinite(rules.thresholds[field]) && rules.thresholds[field] >= 0 && rules.thresholds[field] <= 1, `Invalid threshold ${field}`);
    }
    assert.ok(rules.thresholds.floor <= rules.thresholds.strong);
    for (const value of Object.values(rules.weights)) assert.ok(Number.isFinite(value) && value >= 0);
    for (const field of ['revisionWords', 'variantWords', 'familyNoise']) {
        for (const word of rules.identity[field]) assert.match(word, /^[a-z]+$/);
    }
    for (const field of ['revisionPatterns', 'variantPatterns']) {
        for (const rule of rules.identity[field]) {
            new RegExp(rule.pattern, 'i');
            assert.ok(typeof rule.value === 'string' || (Number.isInteger(rule.group) && rule.group > 0));
        }
    }
    return rules;
}

function validateData(data) {
    assert.ok(Array.isArray(data) && data.length > 0, 'Dataset must be a nonempty array');
    data.forEach((entry, i) => {
        for (const field of ['brand', 'model']) assert.ok(typeof entry[field] === 'string' && entry[field].trim(), `Entry ${i}: invalid ${field}`);
        assert.match(entry.tier, /^[A-F][+-]?$/, `Entry ${i}: invalid tier`);
        assert.equal(typeof entry.is_limited, 'boolean', `Entry ${i}: invalid is_limited`);
        for (const field of identityFields.filter((f) => !['is_limited', 'tier', 'brand', 'model'].includes(f))) {
            assert.ok(entry[field] === null || typeof entry[field] === 'string', `Entry ${i}: invalid ${field}`);
        }
    });
    return data;
}

function loadDataset(file = process.env.PSU_DATA_FILE || path.join(root, 'tests/fixtures/sample_psu_data.json')) {
    const resolved = path.resolve(file);
    const bytes = fs.readFileSync(resolved);
    return { data: validateData(JSON.parse(bytes.toString('utf8'))), file: resolved,
        sha256: createHash('sha256').update(bytes).digest('hex') };
}

function validateCase(tc) {
    for (const key of Object.keys(tc)) assert.ok(caseFields.has(key), `Unknown case field: ${key}`);
    assert.ok(typeof tc.name === 'string' && tc.name.trim(), 'Case requires a name');
    assert.ok(Object.hasOwn(tc, 'expectTier'), 'Case requires expectTier');
    if (tc.wattage !== undefined) assert.ok(Number.isFinite(tc.wattage) && tc.wattage >= 0, 'Invalid wattage');
    for (const field of ['efficiency', 'efficiencyNote', 'formFactor', 'modular', 'site', 'note']) {
        if (tc[field] != null) assert.equal(typeof tc[field], 'string', `Invalid ${field}`);
    }
    if (tc.expectTier !== null) {
        const tiers = Array.isArray(tc.expectTier) ? tc.expectTier : [tc.expectTier];
        assert.ok(tiers.length > 0);
        tiers.forEach((tier) => assert.match(tier, /^[A-F][+-]?$/));
    }
    for (const field of ['minBand', 'maxBand']) {
        if (tc[field] !== undefined) assert.ok(Object.hasOwn(BAND_RANK, tc[field]), `Invalid ${field}`);
    }
    if (tc.minBand && tc.maxBand) assert.ok(BAND_RANK[tc.minBand] <= BAND_RANK[tc.maxBand]);
    for (const field of ['expectLimited', 'expectContested', 'expectAmbiguous']) {
        if (tc[field] !== undefined) assert.equal(typeof tc[field], 'boolean', `Invalid ${field}`);
    }
    if (tc.expectModel !== undefined) assert.ok(typeof tc.expectModel === 'string' && tc.expectModel.length);
    if (tc.forbidModels !== undefined) {
        assert.ok(Array.isArray(tc.forbidModels));
        tc.forbidModels.forEach((model) => assert.equal(typeof model, 'string'));
    }
    if (tc.expectIdentity !== undefined) {
        const identities = Array.isArray(tc.expectIdentity) ? tc.expectIdentity : [tc.expectIdentity];
        assert.ok(identities.length > 0);
        for (const identity of identities) {
            assert.ok(identity && typeof identity === 'object' && !Array.isArray(identity));
            assert.ok(identity.brand && identity.model, 'Identity requires brand and model');
            for (const key of Object.keys(identity)) assert.ok(identityFields.includes(key), `Unknown identity field: ${key}`);
        }
    }
    if (tc.expectTier === null) {
        for (const field of ['expectIdentity', 'expectModel', 'minBand', 'maxBand', 'expectLimited', 'expectContested', 'expectAmbiguous']) {
            assert.equal(tc[field], undefined, `No-match case cannot assert ${field}`);
        }
    }
    return tc;
}

function assertMatch(tc, result) {
    validateCase(tc);
    if (tc.expectTier === null) return assert.equal(result, null, `${tc.name}: expected no match`);
    assert.ok(result, `${tc.name}: expected a match`);
    assert.ok(Object.hasOwn(BAND_RANK, result.band), 'Invalid result band');
    const tiers = Array.isArray(tc.expectTier) ? tc.expectTier : [tc.expectTier];
    assert.ok(tiers.includes(result.entry.tier), `${tc.name}: unexpected tier ${result.entry.tier} (${result.entry.model})`);
    assert.ok(Number.isFinite(result.confidence) && result.confidence >= 0 && result.confidence <= 1);
    if (tc.expectModel !== undefined) assert.equal(result.entry.model, tc.expectModel, tc.name);
    if (tc.expectIdentity !== undefined) {
        const identities = Array.isArray(tc.expectIdentity) ? tc.expectIdentity : [tc.expectIdentity];
        assert.ok(identities.some((id) => Object.entries(id).every(([key, value]) => result.entry[key] === value)),
            `${tc.name}: wrong identity ${JSON.stringify(result.entry)}`);
    }
    if (tc.minBand) assert.ok(BAND_RANK[result.band] >= BAND_RANK[tc.minBand], `${tc.name}: band below ${tc.minBand}`);
    if (tc.maxBand) assert.ok(BAND_RANK[result.band] <= BAND_RANK[tc.maxBand], `${tc.name}: band above ${tc.maxBand}`);
    /** @type {Array<[string, boolean]>} */
    const flags = [['expectLimited', !!result.entry.is_limited], ['expectContested', !!result.contested], ['expectAmbiguous', !!result.ambiguous]];
    for (const [field, actual] of flags) {
        if (tc[field] !== undefined) assert.equal(actual, tc[field], `${tc.name}: ${field}`);
    }
    for (const candidate of [result, ...result.alternates]) {
        assert.ok(!(tc.forbidModels || []).includes(candidate.entry.model), `${tc.name}: forbidden candidate ${candidate.entry.model}`);
    }
}

module.exports = { root, readJson, loadDataset, validateData, validateCase, validateRules, assertMatch };
