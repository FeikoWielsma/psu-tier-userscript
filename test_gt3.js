const fs = require('fs');
const matcher = require('./src/matcher.js');
const psuData = JSON.parse(fs.readFileSync('psu_data.json'));
const rules = JSON.parse(fs.readFileSync('data/normalization_rules.json'));
const index = matcher.buildIndex(psuData, rules);

for (const entry of index.byBrand.thermaltake || []) {
    if (entry.model.includes("Toughpower GT")) {
        console.log("Candidate:", entry.model);
        console.log("Tokens:", entry._tokens);
    }
}
