/*
 * Adapter tests. Loads the real site adapters (src/adapters.js) against saved
 * HTML fixtures using linkedom, so the structured extraction (name, wattage,
 * efficiency, form factor, modular) is verified offline. The PCPartPicker
 * fixtures are real saved pages; refresh them with `npm run capture`.
 */
const fs = require('fs');
const path = require('path');
const { parseHTML } = require('linkedom');

function loadAdapters(hostname, pathname) {
    global.location = /** @type {any} */ ({ hostname, pathname });
    delete require.cache[require.resolve('../src/adapters.js')];
    return require('../src/adapters.js');
}

function loadFixture(file) {
    const html = fs.readFileSync(path.join(__dirname, 'fixtures', file), 'utf8');
    const { document } = parseHTML(`<!doctype html><html><body>${html}</body></html>`);
    global.document = document;
    return document;
}

let failures = 0;
const fail = (msg) => { failures++; console.log('  FAIL  ' + msg); };
console.log('Adapter tests\n');

// --- Tweakers (synthetic fixture; no live capture committed) ----------------
{
    const { activeAdapter } = loadAdapters('tweakers.net', '/voedingen/vergelijken/');
    const adapter = activeAdapter();
    const document = loadFixture('tweakers-voedingen.html');
    const rows = [...document.querySelectorAll(adapter.selector)];
    const expect = [
        { nameIncludes: 'Corsair RM850x', wattage: 850 },
        { nameIncludes: 'Straight Power 12', wattage: 1000 }
    ];
    if (!adapter || adapter.id !== 'tweakers') fail(`Tweakers adapter not active (got ${adapter && adapter.id})`);
    else if (rows.length !== expect.length) fail(`Tweakers selector matched ${rows.length} rows, expected ${expect.length}`);
    else rows.forEach((row, i) => {
        const s = adapter.extract(row);
        if (s && s.name.indexOf(expect[i].nameIncludes) !== -1 && s.wattage === expect[i].wattage) {
            console.log(`  PASS  Tweakers #${i + 1}: "${s.name}" @ ${s.wattage}W`);
        } else {
            fail(`Tweakers #${i + 1}: ${JSON.stringify(s)}`);
        }
    });
}

// --- PCPartPicker (real saved pages) ----------------------------------------
{
    const { activeAdapter } = loadAdapters('pcpartpicker.com', '/products/power-supply/');
    const adapter = activeAdapter();
    const dir = path.join(__dirname, 'fixtures', 'pcpp');

    for (const file of fs.readdirSync(dir).filter((f) => f.endsWith('.html'))) {
        const document = loadFixture(path.join('pcpp', file));
        const rows = [...document.querySelectorAll(adapter.selector)];
        let bad = 0;
        let withForm = 0;
        let withEff = 0;
        for (const row of rows) {
            const s = adapter.extract(row);
            if (!s || !s.name) { bad++; continue; }
            // Clean name: no review-count "(123)" (a 4-digit year is fine), no double spaces.
            const nonYearParen = /\((\d+)\)/.test(s.name) && !/\((?:19|20)\d\d\)/.test(s.name);
            if (nonYearParen || /\s{2,}/.test(s.name) || !(s.wattage > 0)) bad++;
            if (s.formFactor) withForm++;
            if (s.efficiency) withEff++;
        }
        // Form factor is on every row; efficiency is blank for genuinely
        // unrated units, so allow a margin there.
        const ok = rows.length > 40 && bad === 0 && withForm > rows.length * 0.9 && withEff > rows.length * 0.8;
        if (ok) console.log(`  PASS  ${file}: ${rows.length} rows, clean, ${withForm} formFactor, ${withEff} efficiency`);
        else fail(`${file}: rows=${rows.length}, bad=${bad}, formFactor=${withForm}, efficiency=${withEff}`);
    }

    // Pinned extraction check on a known NZXT row.
    const document = loadFixture(path.join('pcpp', 'pcpp-nzxt.html'));
    const target = [...document.querySelectorAll(adapter.selector)]
        .map((r) => adapter.extract(r))
        .find((s) => s && /^NZXT C750$/.test(s.name));
    if (target && target.wattage === 750 && /bronze/i.test(target.efficiency) && /atx/i.test(target.formFactor)) {
        console.log(`  PASS  pinned NZXT C750: ${JSON.stringify(target)}`);
    } else {
        fail(`pinned NZXT C750 extraction: ${JSON.stringify(target)}`);
    }
}

if (failures) {
    console.log(`\n${failures} adapter checks failed.`);
    process.exit(1);
}
console.log('\nAll adapter tests passed.');
