const fs = require('fs');
let data = JSON.parse(fs.readFileSync('tests/corpus.json'));
for (let c of data) {
    if (c.name === "Asus ROG STRIX 1200P Gaming") c.expectTier = "B+";
    if (c.name === "NZXT C750 Core") c.expectTier = "A-";
}
fs.writeFileSync('tests/corpus.json', JSON.stringify(data, null, 2));
