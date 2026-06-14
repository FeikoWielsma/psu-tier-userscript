const fs = require('fs');
const matcher = require('./src/matcher.js');
const psuData = JSON.parse(fs.readFileSync('psu_data.json'));
const rules = JSON.parse(fs.readFileSync('data/normalization_rules.json'));
const index = matcher.buildIndex(psuData, rules);

const r1 = matcher.match("Thermaltake Toughpower GF3 TT Premium", { wattage: 850 }, index, rules);
console.log("Matched:", r1 ? r1.entry.model : "null", r1 ? r1.confidence : "");
