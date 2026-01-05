const fs = require('fs');
const path = require('path');

// Load Data
const psuDataPath = path.join(__dirname, '../psu_lookup_map.json');
if (!fs.existsSync(psuDataPath)) {
    console.error("Error: psu_lookup_map.json not found. Run generate_userscript.py first.");
    process.exit(1);
}
const psuData = JSON.parse(fs.readFileSync(psuDataPath, 'utf8'));

// MATCHING LOGIC (Synced with userscript v1.8)
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

function checkEfficiency(itemEfficiency, productName) {
    if (!itemEfficiency) return true;
    const nameLower = productName.toLowerCase();

    const hasGold = nameLower.includes('gold');
    const hasBronze = nameLower.includes('bronze');
    const hasSilver = nameLower.includes('silver');
    const hasPlatinum = nameLower.includes('platinum');
    const hasTitanium = nameLower.includes('titanium');
    const hasWhite = nameLower.includes('white') || nameLower.includes('standard') || (nameLower.includes('80+') && !nameLower.includes('gold') && !nameLower.includes('bronze') && !nameLower.includes('silver') && !nameLower.includes('platinum') && !nameLower.includes('titanium'));

    const iEff = itemEfficiency.toLowerCase();
    const isGold = iEff.includes('gold');
    const isBronze = iEff.includes('bronze');
    const isSilver = iEff.includes('silver');
    const isPlatinum = iEff.includes('platinum');
    const isTitanium = iEff.includes('titanium');
    const isWhite = iEff.includes('white') || iEff.includes('standard');

    // Mismatch logic
    if (isGold && (hasBronze || hasSilver || hasPlatinum || hasTitanium || hasWhite)) return false;
    if (isBronze && (hasGold || hasSilver || hasPlatinum || hasTitanium || hasWhite)) return false;
    if (isSilver && (hasGold || hasBronze || hasPlatinum || hasTitanium || hasWhite)) return false;
    if (isPlatinum && (hasGold || hasBronze || hasSilver || hasTitanium || hasWhite)) return false;
    if (isTitanium && (hasGold || hasBronze || hasSilver || hasPlatinum || hasWhite)) return false;
    if (isWhite && (hasGold || hasBronze || hasSilver || hasPlatinum || hasTitanium)) return false;

    return true;
}

function getEffectiveLength(str) {
    const effWords = /(gold|bronze|platinum|titanium|silver|white|80\+|standard)/gi;
    return str.replace(effWords, '').replace(/[^a-z0-9]/gi, '').length;
}

function checkSignificantMismatch(candidateSeries, productName) {
    const sigRegex = /\b(GF\s*A3|GF\d+|BM\d+|BX\d+|GT|GX|PX|TX|SFX|TR2)\b/ig;
    const nameMatches = productName.match(sigRegex);
    if (!nameMatches) return false;

    const candNorm = normalize(candidateSeries);
    for (const m of nameMatches) {
        if (!candNorm.includes(normalize(m))) return true;
    }
    return false;
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

    // Thermaltake Smart 80+ (White) handling
    if (/Thermaltake\s+Smart\b.*80\+/i.test(processedName) && !/(BX|BM|DPS|Pro|RGB|Gold|Bronze|Platinum)/i.test(processedName)) {
        processedName = processedName.replace(/Smart/i, 'Smart White Label');
    }
    processedName = processedName.replace(/Toughpower GF3(?! ARGB| Snow)/i, 'Toughpower GF3 Premium, Original');
    processedName = processedName.replace(/Toughpower GF A3(?! Global| Hydrangea| Swap| Snow)/i, 'Toughpower GF A3 Swap');

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
    // Prioritize longer, but discount efficiency words for "Effective Length"
    candidates.sort((a, b) => {
        const lenA = getEffectiveLength(a.matchSeries);
        const lenB = getEffectiveLength(b.matchSeries);
        if (lenA !== lenB) return lenB - lenA; // Descending effective length
        return a.matchSeries.length - b.matchSeries.length;
    });

    let cleanName = normFullName.replace(brandKey, '');
    if (productWattage) {
        const wattageStr = productWattage.toString();
        cleanName = cleanName.replace(wattageStr + 'w', '').replace(wattageStr, '');
    }

    for (const item of candidates) {
        let seriesNorm = normalize(item.matchSeries);
        if (cleanName.includes('gf3') && item.matchSeries.toLowerCase().includes('gf3')) {
            console.log(`[DEBUG] Checking ${item.matchSeries} (Norm: ${seriesNorm}) against ${cleanName}`);
            const wCheck = checkWattage(item.wattage, productWattage);
            const eCheck = checkEfficiency(item.efficiency, fullName);
            const mCheck = !checkSignificantMismatch(item.matchSeries, fullName);
            console.log(`       Stats: Wattage=${wCheck}, Eff=${eCheck}, Mismotch=${mCheck}`);
        }

        // 1. Strict
        if (cleanName.includes(seriesNorm)) {
            if (checkWattage(item.wattage, productWattage) && checkEfficiency(item.efficiency, fullName) && !checkSignificantMismatch(item.matchSeries, fullName)) return item.tier;
        }

        // 2. Tokenized Match
        const noise = new Set(['modular', 'non', 'full', 'mod', 'semi', 'series']);
        const tokens = item.matchSeries.toLowerCase().split(/[\s\-\/]+/).map(normalize).filter(t => t.length > 0 && !noise.has(t));

        if (tokens.length > 1) {
            const allTokensPresent = tokens.every(t => cleanName.includes(t));
            if (allTokensPresent) {
                if (checkWattage(item.wattage, productWattage) && checkEfficiency(item.efficiency, fullName) && !checkSignificantMismatch(item.matchSeries, fullName)) return item.tier;
            }
        }

        // 3. Fallback (No efficiency)
        const efficiencyRegex = /(gold|bronze|platinum|titanium|silver|white)/g;
        const seriesNoEff = seriesNorm.replace(efficiencyRegex, '');
        if (seriesNoEff.length > 2 && cleanName.includes(seriesNoEff)) {
            if (checkWattage(item.wattage, productWattage) && checkEfficiency(item.efficiency, fullName) && !checkSignificantMismatch(item.matchSeries, fullName)) return item.tier;
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
    { name: "MSI MAG A850GL PCIE5", wattage: 850, expectedTier: "B" },
    { name: "be quiet! Pure Power 12 M 850W", wattage: 850, expectedTier: "A" },
    { name: "Lian Li Edge EG 1000", wattage: 1000, expectedTier: "A" },
    { name: "Asus ROG STRIX 1200P Gaming", wattage: 1200, expectedTier: "A", expectedTierAlt: "B+" },
    { name: "Cooler Master V850 SFX GOLD", wattage: 850, expectedTier: "A" },
    { name: "Corsair RM1000x", wattage: 1000, expectedTier: "A", expectedTierAlt: "A+" },
    { name: "Asus TUF Gaming 850G", wattage: 850, expectedTier: "B" },
    { name: "SeaSonic CORE GX ATX 3 (2024)", wattage: 750, expectedTier: "B-", expectedTierAlt: "B" },
    { name: "NZXT C (2019)", wattage: 850, expectedTier: "A" },
    { name: "NZXT C850 (2022)", wattage: 850, expectedTier: "A" },
    { name: "NZXT C850 (2024)", wattage: 850, expectedTier: "A+", expectedTierAlt: "A" },
    { name: "Montech Century II 850W 80+ Gold", wattage: 850, expectedTier: "A-" },
    { name: "Montech Century II 1050W", wattage: 1050, expectedTier: "A" },
    { name: "Montech Century II 1200W", wattage: 1200, expectedTier: "A" },

    // Thermaltake Regression Tests (Added v1.8)
    { name: "Thermaltake Smart 600W 80+", wattage: 600, expectedTier: "F" },
    { name: "Thermaltake Toughpower GF1 (2024)", wattage: 750, expectedTier: null }, // Unrated
    { name: "Thermaltake Toughpower GT", wattage: 750, expectedTier: null }, // Unrated
    { name: "Thermaltake Toughpower GF3 850W", wattage: 850, expectedTier: "A+", expectedTierAlt: "A" },

    // GF A3 matching issue (v1.9)
    { name: "Thermaltake Toughpower GF A3 ATX 3.0", wattage: 750, expectedTier: "B-", expectedTierAlt: "B" }
];

let failures = 0;
console.log("Running PSU Tier Matching Tests (v1.8 Logic)...\n");

testCases.forEach((tc, idx) => {
    const tier = findTier(tc.name, tc.wattage);
    const pass = tier === tc.expectedTier || tier === tc.expectedTierAlt;

    if (pass) {
        console.log(`[PASS] ${tc.name} (${tc.wattage}W) -> Tier ${tier}`);
    } else {
        failures++;
        console.log(`[FAIL] ${tc.name} (${tc.wattage}W)`);
        console.log(`       Expected: ${tc.expectedTier}, Got: ${tier}`);
    }
});

if (failures > 0) {
    console.log(`\n${failures} tests failed.`);
    process.exit(1);
} else {
    console.log("\nAll tests passed!");
    process.exit(0);
}
