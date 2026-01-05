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

    function checkEfficiency(itemEfficiency, productName) {
        // If item has no efficiency specified, we can't easily filter.
        // Assuming itemEfficiency comes from our parsed JSON (e.g. "80+ Gold", "80+ Bronze")
        if (!itemEfficiency) return true;

        const nameLower = productName.toLowerCase();

        // Extract ratings from name
        const hasGold = nameLower.includes('gold');
        const hasBronze = nameLower.includes('bronze');
        const hasSilver = nameLower.includes('silver');
        const hasPlatinum = nameLower.includes('platinum');
        const hasTitanium = nameLower.includes('titanium');
        const hasWhite = nameLower.includes('white') || nameLower.includes('standard') || (nameLower.includes('80+') && !nameLower.includes('gold') && !nameLower.includes('bronze') && !nameLower.includes('silver') && !nameLower.includes('platinum') && !nameLower.includes('titanium'));

        // Identify item rating
        const iEff = itemEfficiency.toLowerCase();
        const isGold = iEff.includes('gold');
        const isBronze = iEff.includes('bronze');
        const isSilver = iEff.includes('silver');
        const isPlatinum = iEff.includes('platinum');
        const isTitanium = iEff.includes('titanium');
        const isWhite = iEff.includes('white') || iEff.includes('standard');

        // Mismatch logic: If Item is Gold, but Name is Bronze -> Fail.
        // If Name has NO rating, we usually assume match is okay (unless strict?).
        // But for "Smart 600W 80+", name has "80+" which implies White.

        if (isGold && (hasBronze || hasSilver || hasPlatinum || hasTitanium || hasWhite)) return false;
        if (isBronze && (hasGold || hasSilver || hasPlatinum || hasTitanium || hasWhite)) return false;
        if (isSilver && (hasGold || hasBronze || hasPlatinum || hasTitanium || hasWhite)) return false;
        if (isPlatinum && (hasGold || hasBronze || hasSilver || hasTitanium || hasWhite)) return false;
        if (isTitanium && (hasGold || hasBronze || hasSilver || hasPlatinum || hasWhite)) return false;
        if (isWhite && (hasGold || hasBronze || hasSilver || hasPlatinum || hasTitanium)) return false;

        return true;
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
        processedName = processedName.replace(/NZXT C(\d+)\s*\(?2019\)?/i, 'NZXT C Series Gold V1 $1');
        processedName = processedName.replace(/NZXT C(\d+)\s*\(?2022\)?/i, 'NZXT C Series Gold V2 $1');
        processedName = processedName.replace(/NZXT C(\d+)\s*\(?2024\)?/i, 'NZXT C Series Gold ATX 3.1 $1');
        processedName = processedName.replace(/NZXT C\s*\(?2019\)?/i, 'NZXT C Series Gold V1');
        processedName = processedName.replace(/NZXT C(\d+)/i, 'NZXT C Series Gold $1');

        // Thermaltake Smart 80+ (White) handling
        if (/Thermaltake\s+Smart\b.*80\+/i.test(processedName) && !/(BX|BM|DPS|Pro|RGB|Gold|Bronze|Platinum)/i.test(processedName)) {
            processedName = processedName.replace(/Smart/i, 'Smart White Label');
        }

        // Thermaltake GF3 handling (Tier list uses "Premium, Original")
        // If it's just "Toughpower GF3" and not ARGB/Snow (unless those are separate?)
        // The list has "GF3 ARGB" as separate.
        // So we map "Toughpower GF3" to include "Premium, Original" if needed, OR just ensure flexible matching?
        // Better to map:
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

        function getEffectiveLength(str) {
            // Remove efficiency words to determine specificness
            const effWords = /(gold|bronze|platinum|titanium|silver|white|80\+|standard)/gi;
            return str.replace(effWords, '').replace(/[^a-z0-9]/gi, '').length;
        }

        if (!brandKey) return null;

        const candidates = psuData[brandKey];
        // Prioritize longer matches, but discount efficiency words
        candidates.sort((a, b) => {
            const lenA = getEffectiveLength(a.matchSeries);
            const lenB = getEffectiveLength(b.matchSeries);
            if (lenA !== lenB) return lenB - lenA; // Descending effective length
            return b.matchSeries.length - a.matchSeries.length; // Tie-break with total length
        });

        let cleanName = normFullName.replace(brandKey, '');
        if (productWattage) {
            // Remove wattage + optional 'w' from the normalized string.
            // Since normFullName has removed non-alphanumerics, '600W' became '600w' or '600'.
            // But normalize() lowercases everything.
            const wattageStr = productWattage.toString();
            // We want to remove "600w" or "600".
            // Replace "600w" first, then "600" if "600w" didn't match?
            // Or just replace tokens.
            cleanName = cleanName.replace(wattageStr + 'w', '').replace(wattageStr, '');
        }

        for (const item of candidates) {
            let seriesNorm = normalize(item.matchSeries);

            // 1. Strict Match
            if (cleanName.includes(seriesNorm)) {
                if (checkWattage(item.wattage, productWattage) && checkEfficiency(item.efficiency, fullName) && !checkSignificantMismatch(item.matchSeries, fullName)) return item;
            }

            // 2. Tokenized Match (Handle "V2 Gold" vs "Gold V2")
            const noise = new Set(['modular', 'non', 'full', 'mod', 'semi', 'series']);
            const tokens = item.matchSeries.toLowerCase().split(/[\s\-\/]+/).map(normalize).filter(t => t.length > 0 && !noise.has(t));

            if (tokens.length > 1) {
                const allTokensPresent = tokens.every(t => cleanName.includes(t));
                if (allTokensPresent) {
                    if (checkWattage(item.wattage, productWattage) && checkEfficiency(item.efficiency, fullName) && !checkSignificantMismatch(item.matchSeries, fullName)) return item;
                }
            }

            // 3. Fallback (No efficiency)
            const efficiencyRegex = /(gold|bronze|platinum|titanium|silver|white)/g;
            const seriesNoEff = seriesNorm.replace(efficiencyRegex, '');
            if (seriesNoEff.length > 2 && cleanName.includes(seriesNoEff)) {
                if (checkWattage(item.wattage, productWattage) && checkEfficiency(item.efficiency, fullName) && !checkSignificantMismatch(item.matchSeries, fullName)) return item;
            }
        }

        return null;
    }

    function showPopup(data, anchorElement) {
        // Remove existing popup if any
        const existing = document.getElementById('psu-tier-popup');
        if (existing) existing.remove();

        const popup = document.createElement('div');
        popup.id = 'psu-tier-popup';
        popup.style.position = 'absolute';
        popup.style.backgroundColor = '#1a1a1a';
        popup.style.color = '#fff';
        popup.style.padding = '15px';
        popup.style.borderRadius = '8px';
        popup.style.boxShadow = '0 4px 15px rgba(0,0,0,0.5)';
        popup.style.zIndex = '999999';
        popup.style.minWidth = '300px';
        popup.style.maxWidth = '400px';
        popup.style.fontFamily = 'sans-serif';
        popup.style.fontSize = '14px';
        popup.style.lineHeight = '1.4';
        popup.style.border = '1px solid #444';

        const keys = [
            { label: 'Brand', val: data.brand },
            { label: 'Series', val: data.series },
            { label: 'Model', val: data.matchSeries },
            { label: 'Wattage', val: data.wattage },
            { label: 'Year', val: data.year },
            { label: 'Form Factor', val: data.form_factor },
            { label: 'ATX Version', val: data.atx_version },
            { label: 'Modular', val: data.modular },
            { label: 'Topology', val: data.topology },
            { label: 'ODM', val: data.odm },
            { label: 'Platform', val: data.platform },
            { label: 'Notes', val: data.notes }
        ];

        let contentHtml = '<h3 style="margin:0 0 10px; border-bottom:1px solid #555; padding-bottom:5px;">PSU Details</h3>';
        contentHtml += '<div style="display:grid; grid-template-columns: 120px 1fr; gap: 5px;">';

        keys.forEach(k => {
            if (k.val && k.val.toString().trim() !== '') {
                contentHtml += `<div style="color:#aaa; font-weight:bold;">${k.label}:</div><div>${k.val}</div>`;
            }
        });
        contentHtml += '</div>';

        // Close button
        contentHtml += '<div style="margin-top:10px; text-align:right;"><button id="psu-popup-close" style="background:#555; color:white; border:none; padding:5px 10px; border-radius:4px; cursor:pointer;">Close</button></div>';

        popup.innerHTML = contentHtml;
        document.body.appendChild(popup);

        // Position popup
        const rect = anchorElement.getBoundingClientRect();
        const scrollTop = window.pageYOffset || document.documentElement.scrollTop;
        const scrollLeft = window.pageXOffset || document.documentElement.scrollLeft;

        popup.style.top = (rect.bottom + scrollTop + 5) + 'px';
        popup.style.left = (rect.left + scrollLeft) + 'px';

        // Close handlers
        document.getElementById('psu-popup-close').onclick = () => popup.remove();

        // Click outside to close
        setTimeout(() => {
            const closeHandler = (e) => {
                if (!popup.contains(e.target)) {
                    popup.remove();
                    document.removeEventListener('click', closeHandler);
                }
            };
            document.addEventListener('click', closeHandler);
        }, 10);
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
            getName: (row) => {
                let name = row.querySelector('td.td__name')?.innerText.trim().split('\n')[0];
                const specCells = row.querySelectorAll('td[class*="td__spec"]');
                for (const cell of specCells) {
                    if (cell.innerText.includes('80+')) {
                        name += ' ' + cell.innerText.replace(/Efficiency Rating\s*/gi, '').trim();
                        break;
                    }
                }
                return name;
            },
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

            const psuItem = findTier(fullName, wattage);

            if (psuItem) {
                const tier = psuItem.tier;
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

                // Add click handler for details
                badge.style.cursor = 'pointer';
                badge.title = 'Click for details';
                badge.addEventListener('click', (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    showPopup(psuItem, badge);
                });
            }

            row.dataset.tierBadged = 'true';
        });
    }

    addBadges();
    const observer = new MutationObserver(addBadges);
    observer.observe(document.body, { childList: true, subtree: true });
})();
