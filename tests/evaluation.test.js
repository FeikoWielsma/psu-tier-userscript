const { test } = require('node:test');
const assert = require('node:assert/strict');
const { summarize, wilson, makeSample, makeHoldout, validateReview, weightedSummary } = require('../tools/benchmark.cjs');

test('evaluation distinguishes precision, recall, FPR and coverage', () => {
    const result = summarize([
        { id: 'a', status: 'rated', returned: true, correct: true, tierCorrect: true },
        { id: 'b', status: 'rated', returned: true, correct: false, tierCorrect: true },
        { id: 'c', status: 'rated', returned: false },
        { id: 'd', status: 'unrated', returned: true },
        { id: 'e', status: 'unrated', returned: false },
        { id: 'f', status: 'unresolved', returned: true }
    ]);
    assert.equal(result.identityPrecision.value, 1 / 3);
    assert.equal(result.tierPrecision.value, 2 / 3);
    assert.equal(result.identityRecall.value, 1 / 3);
    assert.equal(result.falseDiscovery.value, 2 / 3);
    assert.equal(result.falsePositiveRate.value, 1 / 2);
    assert.equal(result.coverage.value, 4 / 6);
    assert.equal(result.unresolvedReturned, 1);
});

test('empty labels do not report perfect accuracy', () => {
    assert.equal(summarize([]).identityPrecision.value, null);
    assert.equal(wilson(0, 0), null);
    assert.ok(wilson(10, 10)[0] < 1);
});

test('review typos, wrong product evidence and unsupported bands fail loudly', () => {
    const product = { id: 'a', name: 'Example Alpha' };
    const good = { id: 'a', productName: product.name, reviewer: 'reviewer', rationale: 'source comparison',
        status: 'rated', sources: [{ file: 'sheet.csv' }], identities: [{ gid: '123', row: 2 }], maxBand: 'likely' };
    validateReview(good, product);
    assert.throws(() => validateReview({ ...good, maxBnad: 'likely' }, product));
    assert.throws(() => validateReview({ ...good, productName: 'Other' }, product));
    assert.throws(() => validateReview({ ...good, maxBand: 'certain' }, product));
    assert.throws(() => validateReview({ ...good, status: 'unresolved' }, product));
});

test('stratified weighting and unresolved bounds use documented denominators', () => {
    const report = weightedSummary([
        { weight: 2, status: 'rated', returned: true, correct: true },
        { weight: 4, status: 'rated', returned: false, correct: false },
        { weight: 4, status: 'unresolved', returned: true, correct: false }
    ]);
    assert.equal(report.identityPrecisionOnResolved, 1);
    assert.equal(report.identityRecallOnResolved, 1 / 3);
    assert.deepEqual(report.precisionBoundsIncludingUnresolvedReturns, [1 / 3, 1]);
});

test('sampling is deterministic and related families share a partition', () => {
    const a = makeSample();
    assert.deepEqual(a, makeSample());
    assert.equal(a.records.length, 300);
    const splits = new Map();
    for (const product of a.records) {
        if (splits.has(product.family)) assert.equal(product.split, splits.get(product.family));
        splits.set(product.family, product.split);
    }
});

test('holdout is deterministic and excludes development families', () => {
    const development = new Set(makeSample().records.map((product) => product.family));
    const holdout = makeHoldout();
    assert.deepEqual(holdout, makeHoldout());
    assert.equal(holdout.records.length, 50);
    for (const product of holdout.records) assert.ok(!development.has(product.family));
});
