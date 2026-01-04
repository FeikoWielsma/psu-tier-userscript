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
// @match        https://*.pcpartpicker.com/products/power-supply/*
// @match        https://tweakers.net/voedingen/vergelijken/*
// @match        https://*.pcpartpicker.com/list/*
// @grant        none
// ==/UserScript==

(function() {{
    'use strict';

    const psuData = {json_str};

    const TierStyles = {{
        'A': {{ bg: '#00ebb9', color: '#000' }},
        'B': {{ bg: '#a4de9a', color: '#000' }},
        'C': {{ bg: '#ffd966', color: '#000' }},
        'D': {{ bg: '#f29738', color: '#000' }},
        'E': {{ bg: '#e06666', color: '#fff' }},
        'F': {{ bg: '#ff4f4f', color: '#fff' }}
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

    const SiteAdapters = {{
        'pcpartpicker': {{
            selector: 'tr.tr__product',
            getName: (row) => row.querySelector('td.td__name')?.innerText.trim().split('\\n')[0],
            getWattage: (row) => {{
                 const cell = row.querySelector('td.td__spec--3');
                 return cell ? parseInt(cell.innerText.replace('W', '').trim(), 10) : 0;
            }},
            insertBadge: (row, badge) => {{
                 const nameCell = row.querySelector('td.td__name');
                 if (nameCell) {{
                     const links = nameCell.querySelectorAll('a');
                     if (links.length > 0) {{
                         const lastLink = links[links.length - 1];
                         lastLink.after(badge);
                     }} else {{
                         nameCell.appendChild(badge);
                     }}
                 }}
            }}
        }},
        'tweakers': {{
            selector: 'ul.item-listing li, tr.listerTableItem', 
            getName: (row) => row.querySelector('a.editionName')?.innerText.trim(),
            getWattage: (row) => {{
                 // Try to look for spec column with 'W'
                 const specs = Array.from(row.querySelectorAll('.spec, td'));
                 for (const s of specs) {{
                     const text = s.innerText.trim();
                     // Match "850W" or "1.000W"
                     if (/^\\d+[\\d\\.]*\\s*W$/.test(text)) {{
                         return parseInt(text.replace('.', '').replace('W', ''), 10);
                     }}
                 }}
                 return 0;
            }},
            insertBadge: (row, badge) => {{
                 const nameEl = row.querySelector('a.editionName');
                 if (nameEl) {{
                     // Insert after the link, maybe wrapped?
                     // Tweakers structure: <p class="edition"> <a ...> ... </a> </p>
                     // Or direct child.
                     nameEl.after(badge);
                 }}
            }}
        }}
    }};

    function getAdapter() {{
        if (window.location.hostname.includes('pcpartpicker')) return SiteAdapters['pcpartpicker'];
        if (window.location.hostname.includes('tweakers')) return SiteAdapters['tweakers'];
        return null;
    }}

    function addBadges() {{
        const adapter = getAdapter();
        if (!adapter) return;

        const rows = document.querySelectorAll(adapter.selector);
        rows.forEach(row => {{
            if (row.dataset.tierBadged) return;
            
            const fullName = adapter.getName(row);
            if (!fullName) return;

            const wattage = adapter.getWattage(row);
            
            const tier = findTier(fullName, wattage);
            
            if (tier) {{
                const badge = document.createElement('span');
                badge.innerText = `Tier ${{tier}}`;
                const base = tier.replace(/[+-]/g, '');
                const style = TierStyles[base] || {{ bg: '#333', color: '#fff' }};
                badge.style.backgroundColor = style.bg;
                badge.style.color = style.color;

                if (tier.includes('+')) {{
                    badge.style.border = '2px solid gold';
                }}
                if (tier.includes('-')) {{
                    badge.style.border = '2px dashed #777';
                }}

                badge.style.marginLeft = '10px';
                badge.style.verticalAlign = 'middle';
                badge.style.display = 'inline-block';
                badge.style.padding = '2px 6px';
                badge.style.borderRadius = '4px';
                badge.style.fontSize = '0.8em';
                badge.style.fontWeight = 'bold';
                badge.className = "tier-badge";
                
                adapter.insertBadge(row, badge);
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
