/* Offline, reproducible sampling and evidence-based evaluation. This module
 * never derives labels from matcher predictions. Review records are separate. */
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const { root, readJson, loadDataset } = require('../tests/helpers.js');
const { buildIndex, match } = require('../src/matcher.js');
const hash = (text) => crypto.createHash('sha256').update(text).digest('hex');
const samplePath = path.join(root, 'tests/benchmark/sample.json');
const reviewsPath = path.join(root, 'tests/benchmark/reviews.json');

function samplingFrame() {
    const sources = [
        ['pcpp', 'tests/fixtures/pcpp-products.json'],
        ['tweakers', 'tools/tweakers_seed.json']
    ];
    const populations = {};
    const products = [];
    const evidence = [];
    for (const [site, file] of sources) {
        const bytes = fs.readFileSync(path.join(root, file));
        evidence.push({ site, file, sha256: hash(bytes), capturedAt: null });
        const unique = new Map();
        for (const raw of JSON.parse(bytes.toString('utf8'))) {
            const product = { name: raw.name, wattage: raw.wattage || 0,
                efficiency: raw.efficiency || null, formFactor: raw.formFactor || null,
                modular: raw.modular || null };
            const key = JSON.stringify(product);
            unique.set(key, { ...product, site, id: `${site}:${hash(key).slice(0, 20)}`,
                url: site === 'tweakers' ? `https://tweakers.net/pricewatch/${raw.id}/` : null });
        }
        populations[site] = unique.size;
        products.push(...unique.values());
    }
    return { populations, products, evidence };
}

function familyOf(product) {
    // Broad grouping intentionally keeps wattage/year/generation siblings in
    // one partition. A family is never split just to improve reported metrics.
    return product.name.toLowerCase().replace(/\b(?:19|20)\d\d\b/g, '')
        .replace(/\d{3,4}/g, '').replace(/[^a-z]+/g, ' ').trim().split(/\s+/).slice(0, 2).join(' ');
}

function makeSample(perSite = 150, seed = 'psu-reliability-v1') {
    const frame = samplingFrame();
    const records = [];
    for (const [site, population] of Object.entries(frame.populations)) {
        const selected = frame.products.filter((p) => p.site === site)
            .sort((a, b) => hash(seed + a.id).localeCompare(hash(seed + b.id)))
            .slice(0, perSite);
        for (const product of selected) {
            const family = familyOf(product);
            records.push({ ...product, family, split: parseInt(hash(seed + family).slice(0, 8), 16) % 5 === 0 ? 'holdout' : 'development',
                inclusionProbability: selected.length / population });
        }
    }
    return { seed, perSite, populations: frame.populations, evidence: frame.evidence,
        scope: 'Saved convenience frames, not a probability sample of the current live catalogs. Capture dates and PCPP URLs were not preserved by the original captures.',
        records };
}

function makeHoldout(perSite = 25, seed = 'psu-reliability-holdout-v1') {
    const development = readJson(samplePath);
    const excluded = new Set(development.records.map((record) => record.family));
    for (const product of readJson(path.join(root, 'tests/corpus.json'))) excluded.add(familyOf(product));
    const frame = samplingFrame();
    const records = [];
    const populations = {};
    for (const site of Object.keys(frame.populations)) {
        const eligible = frame.products.filter((product) => product.site === site && !excluded.has(familyOf(product)));
        populations[site] = eligible.length;
        const selected = eligible.sort((a, b) => hash(seed + a.id).localeCompare(hash(seed + b.id))).slice(0, perSite);
        for (const product of selected) records.push({ ...product, family: familyOf(product), split: 'holdout', inclusionProbability: selected.length / eligible.length });
    }
    return { seed, perSite, populations, evidence: frame.evidence,
        scope: 'Family-disjoint remainder of saved convenience frames after excluding every family in the 300-product development sample and curated regression corpus. Conditional scope; not representative of full frames or live catalogs.', records };
}

function wilson(successes, total) {
    if (!total) return null;
    const z = 1.959963984540054;
    const p = successes / total;
    const denominator = 1 + z * z / total;
    const center = (p + z * z / (2 * total)) / denominator;
    const margin = z * Math.sqrt((p * (1 - p) + z * z / (4 * total)) / total) / denominator;
    return [Math.max(0, center - margin), Math.min(1, center + margin)];
}

function summarize(rows) {
    const resolved = rows.filter((r) => r.status !== 'unresolved');
    const returned = resolved.filter((r) => r.returned);
    const rated = resolved.filter((r) => r.status === 'rated');
    const negatives = resolved.filter((r) => r.status === 'unrated');
    const correct = returned.filter((r) => r.correct);
    const tierCorrect = returned.filter((r) => r.tierCorrect);
    const ratio = (numerator, denominator) => ({ numerator, denominator, value: denominator ? numerator / denominator : null });
    return {
        sampled: rows.length, resolved: resolved.length, unresolved: rows.length - resolved.length,
        coverage: ratio(rows.filter((r) => r.returned).length, rows.length),
        identityPrecision: { ...ratio(correct.length, returned.length), wilson95: wilson(correct.length, returned.length) },
        tierPrecision: ratio(tierCorrect.length, returned.length),
        identityRecall: ratio(correct.length, rated.length),
        falseDiscovery: ratio(returned.length - correct.length, returned.length),
        falsePositiveRate: ratio(negatives.filter((r) => r.returned).length, negatives.length),
        unresolvedReturned: rows.filter((r) => r.status === 'unresolved' && r.returned).length,
        errors: resolved.filter((r) => r.returned && !r.correct).map((r) => r.id),
        overconfident: resolved.filter((r) => r.returned && r.maxBand === 'likely' && r.band === 'strong').map((r) => r.id)
    };
}

function validateReview(review, product) {
    const fields = new Set(['id', 'productName', 'reviewer', 'sources', 'status', 'identities', 'rationale', 'maxBand']);
    assert.ok(review, `Missing review: ${product.id}`);
    for (const key of Object.keys(review)) assert.ok(fields.has(key), `Unknown review field: ${key}`);
    assert.equal(review.productName, product.name, `Review/product mismatch: ${product.id}`);
    assert.ok(['rated', 'unrated', 'unresolved'].includes(review.status));
    assert.ok(typeof review.rationale === 'string' && review.rationale.trim());
    assert.ok(typeof review.reviewer === 'string' && review.reviewer.trim());
    assert.ok(Array.isArray(review.sources) && review.sources.length);
    review.sources.forEach((source) => assert.ok(typeof source.file === 'string' && source.file.trim()));
    assert.ok(Array.isArray(review.identities));
    if (review.status === 'rated') {
        assert.ok(review.identities.length > 0);
        assert.ok(['likely', 'strong'].includes(review.maxBand));
    } else {
        assert.equal(review.identities.length, 0);
        assert.equal(review.maxBand, undefined, 'Unresolved/unrated records cannot assert a band');
    }
    for (const source of review.identities) {
        assert.deepEqual(Object.keys(source).sort(), ['gid', 'row']);
        assert.ok(typeof source.gid === 'string' && Number.isInteger(source.row) && source.row > 1);
    }
}

function weightedSummary(rows) {
    const sum = (items) => items.reduce((total, row) => total + row.weight, 0);
    const returned = rows.filter((row) => row.returned);
    const resolved = returned.filter((row) => row.status !== 'unresolved');
    const correct = sum(resolved.filter((row) => row.correct));
    const rated = rows.filter((row) => row.status === 'rated');
    return {
        description: 'Inverse-inclusion-probability weighted descriptive ratios for saved sampling frames. Unresolved-case exclusion can bias them; no live-catalog or independent-validation claim.',
        identityPrecisionOnResolved: sum(resolved) ? correct / sum(resolved) : null,
        identityRecallOnResolved: sum(rated) ? correct / sum(rated) : null,
        precisionBoundsIncludingUnresolvedReturns: sum(returned)
            ? [correct / sum(returned), (correct + sum(returned.filter((row) => row.status === 'unresolved'))) / sum(returned)] : null
    };
}

function evaluate(sample, reviews, dataset, rules) {
    if (sample.records.length !== new Set(sample.records.map((p) => p.id)).size) throw new Error('Duplicate sampled IDs');
    const reviewed = new Map(reviews.records.map((r) => [r.id, r]));
    if (reviewed.size !== reviews.records.length) throw new Error('Duplicate review IDs');
    if (reviews.datasetSha256 !== dataset.sha256) throw new Error('Review evidence is stale: dataset changed');
    const index = buildIndex(dataset.data, rules);
    const rows = sample.records.map((product) => {
        const review = reviewed.get(product.id);
        validateReview(review, product);
        assert.ok(product.inclusionProbability > 0 && product.inclusionProbability <= 1);
        const expected = (review.identities || []).map((source) => {
            const entries = dataset.data.filter((entry) => entry.source?.gid === source.gid && entry.source?.row === source.row);
            if (entries.length !== 1) throw new Error(`Invalid sheet evidence: ${product.id}`);
            return entries[0];
        });
        const result = match(product.name, product, index, rules);
        return { id: product.id, site: product.site, split: product.split, weight: 1 / product.inclusionProbability,
            status: review.status, maxBand: review.maxBand, returned: !!result,
            band: result?.band || null,
            correct: !!result && expected.some((entry) => entry.source.gid === result.entry.source.gid && entry.source.row === result.entry.source.row),
            tierCorrect: !!result && expected.some((entry) => entry.tier === result.entry.tier),
            actual: result ? { model: result.entry.model, tier: result.entry.tier, source: result.entry.source } : null };
    });
    if (reviewed.size !== rows.length) throw new Error('Reviews contain IDs outside the sample');
    const slices = {};
    for (const key of ['site', 'split', 'band']) {
        slices[key] = Object.fromEntries([...new Set(rows.map((r) => r[key]))].map((value) => [value || 'unmatched', summarize(rows.filter((r) => r[key] === value))]));
    }
    return { datasetSha256: dataset.sha256, scope: sample.scope,
        note: 'Resolved-case estimates exclude unresolved identities and can be biased. Wilson intervals treat observations as independent; repeated families reduce effective sample size. Report site/partition slices; do not pool this stratified sample as a live-catalog accuracy estimate.',
        reviewMethod: reviews.reviewMethod, holdoutStatus: reviews.holdoutStatus,
        overall: summarize(rows), weightedSavedFrame: weightedSummary(rows), slices, rows };
}

function main() {
    const holdout = process.argv.includes('--holdout');
    const selectedSample = holdout ? path.join(root, 'tests/benchmark/holdout.json') : samplePath;
    const selectedReviews = holdout ? path.join(root, 'tests/benchmark/holdout-reviews.json') : reviewsPath;
    if (process.argv.includes('--sample')) {
        if (fs.existsSync(selectedSample)) throw new Error('Sample already exists; create a new benchmark version explicitly');
        fs.mkdirSync(path.dirname(samplePath), { recursive: true });
        fs.writeFileSync(selectedSample, JSON.stringify(holdout ? makeHoldout() : makeSample(), null, 2) + '\n');
        return;
    }
    const sample = readJson(selectedSample);
    const expectedSample = holdout ? makeHoldout(sample.perSite, sample.seed) : makeSample(sample.perSite, sample.seed);
    if (JSON.stringify(sample) !== JSON.stringify(expectedSample)) throw new Error('Sample or source frame changed');
    const report = evaluate(sample, readJson(selectedReviews), loadDataset(), readJson(path.join(root, 'data/normalization_rules.json')));
    report.evaluatedMatcherSha256 = hash(fs.readFileSync(path.join(root, 'src/matcher.js')));
    fs.mkdirSync(path.join(root, 'reports'), { recursive: true });
    fs.writeFileSync(path.join(root, holdout ? 'reports/holdout.json' : 'reports/benchmark.json'), JSON.stringify(report, null, 2) + '\n');
    console.log(`Reviewed sample: ${report.overall.resolved}/${report.overall.sampled} resolved; ${report.overall.unresolved} unresolved.`);
    for (const [site, slice] of Object.entries(report.slices.site)) {
        console.log(`${site}: identity ${slice.identityPrecision.numerator}/${slice.identityPrecision.denominator} returned; recall ${slice.identityRecall.numerator}/${slice.identityRecall.denominator}; false matches ${slice.errors.length}; overconfident ${slice.overconfident.length}`);
    }
    const policy = readJson(path.join(root, holdout ? 'tests/benchmark/holdout-policy.json' : 'tests/benchmark/policy.json'));
    if (policy.datasetSha256 !== report.datasetSha256) throw new Error('Benchmark policy needs review for the new snapshot');
    for (const [site, minimum] of Object.entries(policy.minimumCorrect)) {
        if (report.slices.site[site].identityRecall.numerator < minimum) throw new Error(`Reviewed recall regressed: ${site}`);
    }
    if (report.overall.errors.length || report.overall.overconfident.length) {
        console.error(JSON.stringify({ incorrect: report.overall.errors, overconfident: report.overall.overconfident }));
        process.exitCode = 1;
    }
}

if (require.main === module) main();
module.exports = { makeSample, makeHoldout, familyOf, evaluate, summarize, wilson, validateReview, weightedSummary };
