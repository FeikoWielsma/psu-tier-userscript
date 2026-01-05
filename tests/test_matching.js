const fs = require('fs');
const path = require('path');

// Load Data
const psuDataPath = path.join(__dirname, '../psu_lookup_map.json');
if (!fs.existsSync(psuDataPath)) {
    console.error("Error: psu_lookup_map.json not found. Run generate_userscript.py first.");
    process.exit(1);
}
const psuData = JSON.parse(fs.readFileSync(psuDataPath, 'utf8'));

// MATCHING LOGIC (Must match userscript EXACTLY)
function normalize(s) {
    return s.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function checkWattage(wattageStr, productWattage) {
    if (!wattageStr || wattageStr === 'All PSUs' || !productWattage) return true;

    // Handle "550/650W" or "550-750W"
    // Remove 'W' and spaces
    const cleanW = wattageStr.toLowerCase().replace('w', '').replace(/\s/g, '');
    const parts = cleanW.split(/[\/\-]/);

    // Range check
    if (wattageStr.includes('-')) {
        const min = parseInt(parts[0]);
        const max = parseInt(parts[parts.length - 1]);
        return productWattage >= min && productWattage <= max;
    } else {
        // Discrete list
        return parts.some(p => Math.abs(parseInt(p) - productWattage) < 10);
    }
}

function findTier(fullName, productWattage) {
    let processedName = fullName;
    processedName = processedName.replace(/(\d+)P Gaming/i, '$1 Platinum');
    processedName = processedName.replace(/V(\d+) SFX/i, 'V Series "Vanguard" SFX $1');
    processedName = processedName.replace(/RM(\d+)x/i, 'RMx 2021 $1');
    processedName = processedName.replace(/(\d+)G(\s|$)/i, '$1 Gold$2');
    processedName = processedName.replace(/ATX 3(?!\.0)/i, 'ATX 3.0');
    processedName = processedName.replace(/Century II/i, 'Century II Gold ATX 3.1');
    // NZXT Specific
    processedName = processedName.replace(/NZXT C(\d+)\s*\(?2019\)?/i, 'NZXT C Series Gold V1 $1');
    processedName = processedName.replace(/NZXT C(\d+)\s*\(?2022\)?/i, 'NZXT C Series Gold V2 $1');
    processedName = processedName.replace(/NZXT C(\d+)\s*\(?2024\)?/i, 'NZXT C Series Gold ATX 3.1 $1');
    processedName = processedName.replace(/NZXT C\s*\(?2019\)?/i, 'NZXT C Series Gold V1');
    processedName = processedName.replace(/NZXT C(\d+)/i, 'NZXT C Series Gold $1');

    const normFullName = normalize(processedName);

    let brandKey = null;
    let bestBrandLength = 0;

    for (const k in psuData) {
        if (k === 'gaming') continue;
        if (normFullName.includes(k)) {
            if (k.length > bestBrandLength) {
                brandKey = k;
                bestBrandLength = k.length;
            }
        }
    }



    if (!brandKey) return null;


    const candidates = psuData[brandKey];
    // Prioritize longer, more specific matches (e.g. "Century II Gold..." over "Century Gold")
    candidates.sort((a, b) => b.matchSeries.length - a.matchSeries.length);

    let cleanName = normFullName.replace(brandKey, '');
    if (productWattage) {
        cleanName = cleanName.replace(productWattage.toString(), '');
    }

    for (const item of candidates) {
        let seriesNorm = normalize(item.matchSeries);
        const efficiencyRegex = /(gold|bronze|platinum|titanium|silver|white)/g;
        const seriesNoEff = seriesNorm.replace(efficiencyRegex, '');




        // 1. Strict
        if (cleanName.includes(seriesNorm)) {
            if (checkWattage(item.wattage, productWattage)) return item.tier;
        }

        // 2. Tokenized Match (Handle "V2 Gold" vs "Gold V2")
        // item.matchSeries is specific e.g. "MWE V2 Gold"
        // Normalize each token and check if cleanName has it.
        // We filter out "noise" tokens like "modular", "non", "full" to prevent mismatch 
        // if the product name in PCPP is "MWE Gold V2" (implied full modular).
        const noise = new Set(['modular', 'non', 'full', 'mod', 'semi', 'series']);
        // 'series' is sometimes in the name e.g. "Atom V Series"

        const tokens = item.matchSeries.toLowerCase().split(/[\s\-\/]+/).map(normalize).filter(t => t.length > 0 && !noise.has(t));


        if (tokens.length > 1) {
            const allTokensPresent = tokens.every(t => cleanName.includes(t));
            if (allTokensPresent) {
                if (checkWattage(item.wattage, productWattage)) return item.tier;
            }
        }

        // 3. Fallback (No efficiency)
        if (seriesNoEff.length > 2 && cleanName.includes(seriesNoEff)) {
            if (checkWattage(item.wattage, productWattage)) return item.tier;
        }
    }

    return null;
}

// TEST CASES
// Format: { name: "Product Name", wattage: 850, expectedTier: "A", expectedTierAlt: "A-" }
const testCases = [
    { name: "1STPLAYER NGDP 850W 80+ Gold", wattage: 850, expectedTier: "A-" },
    { name: "Antec Earthwatts Gold Pro 750W", wattage: 750, expectedTier: "A-" },
    { name: "Corsair RM850x (2018)", wattage: 850, expectedTier: "A" },
    { name: "Corsair RM750e (2023)", wattage: 750, expectedTier: "B+" },
    { name: "Lian Li SP750", wattage: 750, expectedTier: "B" },
    { name: "Cooler Master MWE Gold 850 V2", wattage: 850, expectedTier: "B+" },
    { name: "MSI MAG A850GL PCIE5", wattage: 850, expectedTier: "B" }, // "MAG A-GL PCIE5" -> B
    { name: "be quiet! Pure Power 12 M 850W", wattage: 850, expectedTier: "A" },
    { name: "Lian Li Edge EG 1000", wattage: 1000, expectedTier: "A" },
    // Regex fix verifications
    { name: "Asus ROG STRIX 1200P Gaming", wattage: 1200, expectedTier: "A", expectedTierAlt: "B+" }, // 1200W might be B+ in some revisions? Debug map says: "ROG Strix Platinum, 1200W, Tier B+"
    { name: "Cooler Master V850 SFX GOLD", wattage: 850, expectedTier: "A" },
    { name: "Corsair RM1000x", wattage: 1000, expectedTier: "A", expectedTierAlt: "A+" },
    { name: "Asus TUF Gaming 850G", wattage: 850, expectedTier: "B" }, // TUF Gold is B tier
    { name: "SeaSonic CORE GX ATX 3 (2024)", wattage: 750, expectedTier: "B-", expectedTierAlt: "B" }, // Changed to B- based on debug data
    { name: "NZXT C (2019)", wattage: 850, expectedTier: "A" },
    { name: "NZXT C850 (2022)", wattage: 850, expectedTier: "A" }, // V2 is A
    { name: "NZXT C850 (2024)", wattage: 850, expectedTier: "A+", expectedTierAlt: "A" }, // ATX 3.1 is A+
    // Montech Fixes
    { name: "Montech Century II 850W 80+ Gold", wattage: 850, expectedTier: "A-" },
    { name: "Montech Century II 1050W", wattage: 1050, expectedTier: "A" },
    { name: "Montech Century II 1200W", wattage: 1200, expectedTier: "A" }
];

let failures = 0;
console.log("Running PSU Tier Matching Tests...\n");

testCases.forEach((tc, idx) => {
    const tier = findTier(tc.name, tc.wattage);
    const pass = tier === tc.expectedTier || tier === tc.expectedTierAlt;

    if (pass) {
        console.log(`[PASS] ${tc.name} (${tc.wattage}W) -> Tier ${tier}`);
    } else {
        failures++;
        console.error(`[FAIL] ${tc.name} (${tc.wattage}W)`);
        console.error(`       Expected: ${tc.expectedTier}, Got: ${tier}`);
    }
});

if (failures > 0) {
    console.log(`\n${failures} tests failed.`);
    process.exit(1);
} else {
    console.log("\nAll tests passed!");
    process.exit(0);
}
