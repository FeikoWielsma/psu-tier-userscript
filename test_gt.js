const fs = require('fs');
const matcher = require('./src/matcher.js');
const psuData = JSON.parse(fs.readFileSync('psu_data.json'));
const rules = JSON.parse(fs.readFileSync('data/normalization_rules.json'));
const index = matcher.buildIndex(psuData, rules);

const r1 = matcher.match("Thermaltake Toughpower GT", { wattage: 750 }, index, rules);
console.log("GT matched:", r1 ? r1.entry.model : "null", r1 ? r1.confidence : "");

const r2 = matcher.match("Thermaltake Toughpower GT Snow", { wattage: 750 }, index, rules);
console.log("GT Snow matched:", r2 ? r2.entry.model : "null", r2 ? r2.confidence : "");

