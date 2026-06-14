const { match, buildIndex } = require('./src/matcher.js');
const rules = require('./data/normalization_rules.json');
const psuData = require('./tests/fixtures/sample_psu_data.json');
const index = buildIndex(psuData, rules);
const res = match("MSI MAG A750GL PCIE5", {wattage: 750}, index, rules);
console.log("BEST MATCH:", res.entry.model, res.confidence);
console.log("ALTERNATES:", res.alternates.map(a => `${a.entry.model} (${a.confidence})`));
