function normalize(s) {
    return s.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function checkWattage(wattageStr, productWattage) {
    if (!wattageStr || wattageStr === 'All PSUs' || !productWattage) return true;
    const cleanW = wattageStr.toLowerCase().replace('w', '').replace(/\s/g, '');
    const parts = cleanW.split(/[\/\-]/);
    if (wattageStr.includes('-')) {
        const min = parseInt(parts[0]);
        const max = parseInt(parts[parts.length - 1]);
        return productWattage >= min && productWattage <= max;
    } else {
        return parts.some(p => Math.abs(parseInt(p) - productWattage) < 10);
    }
}

// Cases
const cases = [
    {
        name: "Cooler Master MWE Gold 850 V2",
        seriesKey: "MWE V2 Gold Full Mod.", // From JSON
        wattageKey: "550-850W",
        prodWattage: 850
    },
    {
        name: "Thermaltake Smart 500W",
        seriesKey: "Smart",
        wattageKey: "430-700W",
        prodWattage: 500
    }
];

cases.forEach(c => {
    console.log(`\nChecking ${c.name}:`);
    const cleanName = normalize(c.name).replace('coolermaster', '').replace('thermaltake', '').replace('850', '').replace('500', '');
    // ^ Approximating the clean logic
    console.log(`Clean Approx: ${cleanName}`);

    // Logic 1: Strict
    const seriesNorm = normalize(c.seriesKey);
    console.log(`Series Norm: ${seriesNorm}`);
    console.log(`Strict Match? ${cleanName.includes(seriesNorm)}`);

    // Logic 2: Tokens
    const tokens = c.seriesKey.toLowerCase().split(/[\s\-\/]+/).map(normalize).filter(t => t.length > 0);
    console.log(`Tokens: ${JSON.stringify(tokens)}`);
    const allTokens = tokens.every(t => cleanName.includes(t));
    console.log(`All Tokens? ${allTokens}`);

    // Logic 3: Fallback
    const seriesNoEff = seriesNorm.replace(/(gold|bronze)/g, '');
    console.log(`Fallback Match? ${seriesNoEff.length > 2 && cleanName.includes(seriesNoEff)}`);

    // Logic Wattage
    console.log(`Wattage Check (${c.wattageKey}, ${c.prodWattage}): ${checkWattage(c.wattageKey, c.prodWattage)}`);
});
