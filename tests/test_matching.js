// Exercise the production matcher against the explicitly selected release data.
const { buildIndex, match } = require('../src/matcher.js');
const { root, readJson, loadDataset, validateCase, validateRules, assertMatch } = require('./helpers.js');
const { data, file, sha256 } = loadDataset();
const rules = validateRules(readJson(`${root}/data/normalization_rules.json`));
const corpus = readJson(`${__dirname}/corpus.json`);
corpus.forEach(validateCase);
const index = buildIndex(data, rules);
let failures = 0;
console.log(`Matching: ${corpus.length} cases; ${data.length} entries\nDataset: ${file}\nSHA256: ${sha256}`);
for (const tc of corpus) {
    try {
        assertMatch(tc, match(tc.name, tc, index, rules));
    } catch (error) {
        failures++;
        console.error(error.message);
    }
}
if (failures) process.exitCode = 1;
console.log(`${corpus.length - failures}/${corpus.length} matching cases passed.`);
