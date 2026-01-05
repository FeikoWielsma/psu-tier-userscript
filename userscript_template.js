// ==UserScript==
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

(function () {
    'use strict';

    const psuData = { 'PSU_DATA_JSON': {} };

    const TierStyles = {
        'A': { bg: '#00ebb9', color: '#000' },
        'B': { bg: '#a4de9a', color: '#000' },
        'C': { bg: '#ffd966', color: '#000' },
        'D': { bg: '#f29738', color: '#000' },
        'E': { bg: '#e06666', color: '#fff' },
        'F': { bg: '#ff4f4f', color: '#fff' }
    };

    function normalize(s) {
        return s.toLowerCase().replace(/[^a-z0-9]/g, '');
    }

    function checkWattage(wattageStr, productWattage) {
        if (!wattageStr || wattageStr === 'All PSUs' || !productWattage) return true;

        // Handle "550/650W" or "550-750W"
        const parts = wattageStr.toLowerCase().replace('w', '').split(/[\/\-]/);
        // It's a range if there matches '-', actually my regex split handles both.
        // Let's look at the original string to decide logic
        if (wattageStr.includes('-')) {
            const min = parseInt(parts[0]);
            const max = parseInt(parts[parts.length - 1]);
            return productWattage >= min && productWattage <= max;
        } else {
            // Discrete list
            return parts.some(p => Math.abs(parseInt(p) - productWattage) < 10); // Tolerance of 10W?
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
        // Prioritize longer matches
        candidates.sort((a, b) => b.matchSeries.length - a.matchSeries.length);

        let cleanName = normFullName.replace(brandKey, '');
        if (productWattage) {
            cleanName = cleanName.replace(productWattage.toString(), '');
        }

        for (const item of candidates) {
            let seriesNorm = normalize(item.matchSeries);

            // 1. Strict Match
            if (cleanName.includes(seriesNorm)) {
                if (checkWattage(item.wattage, productWattage)) return item.tier;
            }

            // 2. Tokenized Match (Handle "V2 Gold" vs "Gold V2")
            const noise = new Set(['modular', 'non', 'full', 'mod', 'semi', 'series']);
            const tokens = item.matchSeries.toLowerCase().split(/[\s\-\/]+/).map(normalize).filter(t => t.length > 0 && !noise.has(t));

            if (tokens.length > 1) {
                const allTokensPresent = tokens.every(t => cleanName.includes(t));
                if (allTokensPresent) {
                    if (checkWattage(item.wattage, productWattage)) return item.tier;
                }
            }

            // 3. Fallback (No efficiency)
            const efficiencyRegex = /(gold|bronze|platinum|titanium|silver|white)/g;
            const seriesNoEff = seriesNorm.replace(efficiencyRegex, '');
            if (seriesNoEff.length > 2 && cleanName.includes(seriesNoEff)) {
                if (checkWattage(item.wattage, productWattage)) return item.tier;
            }
        }

        return null;
    }

    const SiteAdapters = {
        'pcpartpicker': {
            selector: 'tr.tr__product',
            filter: (row) => {
                if (window.location.pathname.includes('/list/')) {
                    const compCell = row.querySelector('td.td__component');
                    if (compCell && compCell.innerHTML.includes('/products/power-supply/')) {
                        return true;
                    }
                    return false;
                }
                return true;
            },
            getName: (row) => row.querySelector('td.td__name')?.innerText.trim().split('\n')[0],
            getWattage: (row) => {
                const cell = row.querySelector('td.td__spec--3');
                return cell ? parseInt(cell.innerText.replace('W', '').trim(), 10) : 0;
            },
            insertBadge: (row, badge) => {
                const nameCell = row.querySelector('td.td__name');
                if (nameCell) {
                    const links = nameCell.querySelectorAll('a');
                    if (links.length > 0) {
                        const lastLink = links[links.length - 1];
                        lastLink.after(badge);
                    } else {
                        nameCell.appendChild(badge);
                    }
                }
            }
        },
        'tweakers': {
            selector: 'ul.item-listing li, tr.listerTableItem',
            getName: (row) => row.querySelector('a.editionName')?.innerText.trim(),
            getWattage: (row) => {
                // Try to look for spec column with 'W'
                const specs = Array.from(row.querySelectorAll('.spec, td'));
                for (const s of specs) {
                    const text = s.innerText.trim();
                    // Match "850W" or "1.000W"
                    if (/^\d+[\d\.]*\s*W$/.test(text)) {
                        return parseInt(text.replace('.', '').replace('W', ''), 10);
                    }
                }
                return 0;
            },
            insertBadge: (row, badge) => {
                const nameEl = row.querySelector('a.editionName');
                if (nameEl) {
                    // Insert after the link, maybe wrapped?
                    // Tweakers structure: <p class="edition"> <a ...> ... </a> </p>
                    // Or direct child.
                    nameEl.after(badge);
                }
            }
        }
    };

    function getAdapter() {
        if (window.location.hostname.includes('pcpartpicker')) return SiteAdapters['pcpartpicker'];
        if (window.location.hostname.includes('tweakers')) return SiteAdapters['tweakers'];
        return null;
    }

    function addBadges() {
        const adapter = getAdapter();
        if (!adapter) return;

        const rows = document.querySelectorAll(adapter.selector);
        rows.forEach(row => {
            if (row.dataset.tierBadged) return;
            if (adapter.filter && !adapter.filter(row)) return;

            const fullName = adapter.getName(row);
            if (!fullName) return;

            const wattage = adapter.getWattage(row);

            const tier = findTier(fullName, wattage);

            if (tier) {
                const badge = document.createElement('span');
                badge.innerText = `Tier ${tier}`;
                const base = tier.replace(/[+-]/g, '');
                const style = TierStyles[base] || { bg: '#333', color: '#fff' };
                badge.style.backgroundColor = style.bg;
                badge.style.color = style.color;

                if (tier.includes('+')) {
                    badge.style.border = '2px solid gold';
                }
                if (tier.includes('-')) {
                    badge.style.border = '2px dashed #777';
                }

                badge.style.marginLeft = '10px';
                badge.style.verticalAlign = 'middle';
                badge.style.display = 'inline-block';
                badge.style.padding = '2px 6px';
                badge.style.borderRadius = '4px';
                badge.style.fontSize = '0.8em';
                badge.style.fontWeight = 'bold';
                badge.className = "tier-badge";

                adapter.insertBadge(row, badge);
            }

            row.dataset.tierBadged = 'true';
        });
    }

    addBadges();
    const observer = new MutationObserver(addBadges);
    observer.observe(document.body, { childList: true, subtree: true });
})();
