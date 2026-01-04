import json
import re

# Helper to normalize brand keys
def normalize_key(s):
    return re.sub(r'[^a-zA-Z0-9]', '', s.lower())

def generate_js_data(json_path):
    with open(json_path, 'r', encoding='utf-8') as f:
        data = json.load(f)

    # Re-organize data by normalized brand for faster lookup
    # Handle "Brand/Alias" by creating references for both
    # e.g. "Antec/Atom" -> psuData['antec'] and psuData['atom']
    psu_map = {}
    
    for item in data:
        # Clean up the definition of brand aliases split by "/"
        # Special case: "FSP (Fortron/Sparkle)" -> "fsp", "fortron", "sparkle"
        raw_brands = item['brand']
        # Remove parenthetical matches for cleaner splitting (e.g. "Abko (Abkoncore)" -> "Abko", "Abkoncore")
        # But slashes inside parens might be tricky.
        # Let's replace parens with space, replace slash with space, then split?
        # "FSP (Fortron/Sparkle)" -> "FSP  Fortron Sparkle " -> ["FSP", "Fortron", "Sparkle"]
        # "Antec/Atom" -> "Antec Atom" -> ["Antec", "Atom"]
        
        # Simple normalization approach:
        cleaned_brand_str = raw_brands.replace('/', ' ').replace('(', ' ').replace(')', ' ')
        brand_tokens = [t for t in cleaned_brand_str.split() if len(t) > 1]
        
        # Always include the original full normalized string just in case
        brand_keys = set()
        brand_keys.add(normalize_key(raw_brands)) # "antecatom"
        for t in brand_tokens:
            brand_keys.add(normalize_key(t)) # "antec", "atom"

        # Special overrides
        if "1st Player" in raw_brands:
            brand_keys.add("1stplayer")
        if "FSP" in raw_brands:
            brand_keys.add("fsp")
            brand_keys.add("fspgroup") 

        for k in brand_keys:
            if not k: continue
            if k not in psu_map:
                psu_map[k] = []
            
            # Create a copy to modify series for matching if needed
            # We will handle multiple series aliases here too
            # "RM-x 2018 / v2 Black" -> split by "/"
            series_str = item['series']
            series_list = [s.strip() for s in series_str.split('/')]
            
            for s in series_list:
                # Remove common efficiency words from matching key because PCPP names often omit them or put them elsewhere
                # e.g. "NGDP Gold" -> Match against "NGDP"
                # But we must be careful not to over-match. "Focus" matches "Focus GX" and "Focus PX"?
                # Let's keep the original series name for display/tie-breaking, 
                # but maybe add a "matchSeries" field.
                
                entry = item.copy()
                entry['matchSeries'] = s # The specific alias
                psu_map[k].append(entry)

    # Sort entries by series length (descending) to match longest specific name first
    for k in psu_map:
        psu_map[k].sort(key=lambda x: len(x['matchSeries']), reverse=True)

    return json.dumps(psu_map)

def generate_userscript():
    json_str = generate_js_data('psu_data.json')
    
    # Write processed data to map file for testing
    with open('psu_lookup_map.json', 'w', encoding='utf-8') as f:
        f.write(json_str)

    # Write data var for testing usage in HTML
    with open('psu_data_var.js', 'w', encoding='utf-8') as f:
        f.write(f"window.psuData = {json_str};")

    js_content = f"""// ==UserScript==
// @name         PCPartPicker PSU Tier Badges
// @namespace    http://tampermonkey.net/
// @version      1.3
// @description  Display PSU Tiers from SPL's list on PCPartPicker
// @author       Antigravity
// @match        https://pcpartpicker.com/products/power-supply/*
// @match        https://pcpartpicker.com/list/*
// @grant        none
// ==/UserScript==

(function() {{
    'use strict';

    const psuData = {json_str};

    const TierColors = {{
        'A': '#32CD32', 'A+': '#32CD32', 'A-': '#32CD32',
        'B': '#1E90FF', 'B+': '#1E90FF', 'B-': '#1E90FF',
        'C': '#FFD700', 'C+': '#FFD700', 'C-': '#FFD700',
        'D': '#FF8C00',
        'E': '#FF4500',
        'F': '#FF0000'
    }};

    function normalize(s) {{
        return s.toLowerCase().replace(/[^a-z0-9]/g, '');
    }}

    function checkWattage(wattageStr, productWattage) {{
        if (!wattageStr || wattageStr === 'All PSUs' || !productWattage) return true;
        
        // Handle "550/650W" or "550-750W"
        const parts = wattageStr.toLowerCase().replace('w','').split(/[\\/\\-]/);
        // It's a range if there matches '-', actually my regex split handles both.
        // Let's look at the original string to decide logic
        if (wattageStr.includes('-')) {{
            const min = parseInt(parts[0]);
            const max = parseInt(parts[parts.length-1]);
            return productWattage >= min && productWattage <= max;
        }} else {{
            // Discrete list
            return parts.some(p => Math.abs(parseInt(p) - productWattage) < 10); // Tolerance of 10W?
        }}
    }}

    function findTier(fullName, productWattage) {{
        const normFullName = normalize(fullName);
        
        let brandKey = null;
        let bestBrandLength = 0;
        
        for (const k in psuData) {{
            if (normFullName.includes(k)) {{
                if (k.length > bestBrandLength) {{
                    brandKey = k;
                    bestBrandLength = k.length;
                }}
            }}
        }}

        if (!brandKey) return null;

        const candidates = psuData[brandKey];
        let cleanName = normFullName.replace(brandKey, '');
        if (productWattage) {{
             cleanName = cleanName.replace(productWattage.toString(), '');
        }}
        
        for (const item of candidates) {{
            let seriesNorm = normalize(item.matchSeries);
            
            // 1. Strict Match
            if (cleanName.includes(seriesNorm)) {{
                if (checkWattage(item.wattage, productWattage)) return item.tier;
            }}
            
            // 2. Tokenized Match (Handle "V2 Gold" vs "Gold V2")
            const noise = new Set(['modular', 'non', 'full', 'mod', 'semi', 'series']); 
            const tokens = item.matchSeries.toLowerCase().split(/[\\s\\-\\/]+/).map(normalize).filter(t => t.length > 0 && !noise.has(t));
            
            if (tokens.length > 1) {{
                 const allTokensPresent = tokens.every(t => cleanName.includes(t));
                 if (allTokensPresent) {{
                     if (checkWattage(item.wattage, productWattage)) return item.tier;
                 }}
            }}

            // 3. Fallback (No efficiency)
            const efficiencyRegex = /(gold|bronze|platinum|titanium|silver|white)/g;
            const seriesNoEff = seriesNorm.replace(efficiencyRegex, '');
            if (seriesNoEff.length > 2 && cleanName.includes(seriesNoEff)) {{
                if (checkWattage(item.wattage, productWattage)) return item.tier;
            }}
        }}
        
        return null;
    }}

    function addBadges() {{
        // Updated selectors for PCPP live site (double underscores)
        const rows = document.querySelectorAll('tr.tr__product');
        rows.forEach(row => {{
            if (row.dataset.tierBadged) return;
            
            const nameCell = row.querySelector('td.td__name');
            // Wattage is usually the 3rd spec column: td.td__spec--3
            const wattageCell = row.querySelector('td.td__spec--3');
            
            if (!nameCell) return;
            
            const fullName = nameCell.innerText.trim().split('\\n')[0]; 
            
            const wattageText = wattageCell ? wattageCell.innerText.replace('W', '').trim() : "0";
            const wattage = parseInt(wattageText, 10);

            const tier = findTier(fullName, wattage);
            
            if (tier) {{
                const badge = document.createElement('span');
                badge.innerText = `Tier ${{tier}}`;
                badge.style.backgroundColor = TierColors[tier.split(' ')[0]] || '#333';
                badge.style.color = 'white';
                badge.style.padding = '2px 6px';
                badge.style.borderRadius = '4px';
                badge.style.marginLeft = '8px';
                badge.style.fontSize = '0.8em';
                badge.style.fontWeight = 'bold';
                badge.className = "tier-badge";
                
                const link = nameCell.querySelector('a');
                if (link) {{
                    nameCell.insertBefore(badge, link.nextSibling);
                }} else {{
                    nameCell.appendChild(badge);
                }}
            }}
            
            row.dataset.tierBadged = 'true';
        }});
    }}

    addBadges();
    const observer = new MutationObserver(addBadges);
    observer.observe(document.body, {{ childList: true, subtree: true }});
}})();
"""

    with open('psutier.user.js', 'w', encoding='utf-8') as f:
        f.write(js_content)
    print("Generated psutier.user.js and psu_data_var.js")

if __name__ == "__main__":
    generate_userscript()
