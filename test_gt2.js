const fs = require('fs');
const matcher = require('./src/matcher.js');
const psuData = JSON.parse(fs.readFileSync('psu_data.json'));
const rules = JSON.parse(fs.readFileSync('data/normalization_rules.json'));
const index = matcher.buildIndex(psuData, rules);

// Expose the internals of matcher if possible, or we can just iterate.
for (const entry of index.byBrand.thermaltake || []) {
    if (entry.model.includes("Toughpower GT Snow") || entry.model === "Toughpower Gold") {
        console.log("Candidate:", entry.model);
        console.log("Tokens:", entry._tokens);
    }
}
