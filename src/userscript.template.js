// ==UserScript==
// @name         PSU Tier Badges (PCPartPicker & Tweakers)
// @namespace    https://github.com/FeikoWielsma/psu-tier-userscript
// @version      2.0.1
// @description  Show SPL's PSU Tier List ratings as badges on PCPartPicker and Tweakers, with match-confidence and details.
// @author       Feiko Wielsma
// @match        https://*.pcpartpicker.com/products/power-supply/*
// @match        https://*.pcpartpicker.com/list/*
// @match        https://tweakers.net/voedingen/vergelijken/*
// @grant        none
// @run-at       document-idle
// ==/UserScript==

(function () {
    'use strict';

    // --- Injected at build time by generate_userscript.py --------------------
    const PSU_DATA = /*__PSU_DATA__*/ [];
    const RULES = /*__RULES__*/ {};
    // The matcher and adapter modules are inlined here; each assigns to its own
    // local `module.exports`.
    const PSUMatcher = (function () {
        const module = { exports: {} };
        /*__MATCHER__*/
        return module.exports;
    })();
    const PSUAdapters = (function () {
        const module = { exports: {} };
        /*__ADAPTERS__*/
        return module.exports;
    })();

    const index = PSUMatcher.buildIndex(PSU_DATA, RULES);

    // --- Presentation -------------------------------------------------------

    const TIER_STYLES = {
        'A': { bg: '#00ebb9', fg: '#000' },
        'B': { bg: '#a4de9a', fg: '#000' },
        'C': { bg: '#ffd966', fg: '#000' },
        'D': { bg: '#f29738', fg: '#000' },
        'E': { bg: '#e06666', fg: '#fff' },
        'F': { bg: '#ff4f4f', fg: '#fff' }
    };

    function tierStyle(tier) {
        return TIER_STYLES[tier.replace(/[+-]/g, '')] || { bg: '#333', fg: '#fff' };
    }

    function makeBadge(result) {
        const tier = result.entry.tier;
        const isLimited = !!result.entry.is_limited;
        const style = tierStyle(tier);
        const likely = result.band === 'likely';

        const badge = document.createElement('span');
        badge.className = 'psu-tier-badge';

        let text = `Tier ${tier}`;
        if (isLimited) text += '* (LC)';
        if (likely) text += '?';
        badge.textContent = text;

        let title = '';
        if (isLimited) title += '[LIMITED CONFIDENCE] Speculative rating! ';
        title += likely
            ? `Likely match (${Math.round(result.confidence * 100)}% confidence) - click for details`
            : `Click for details (${Math.round(result.confidence * 100)}% confidence)`;
        badge.title = title;

        Object.assign(badge.style, {
            display: 'inline-block',
            padding: '2px 6px',
            marginLeft: '8px',
            borderRadius: '4px',
            fontSize: '0.8em',
            fontWeight: 'bold',
            verticalAlign: 'middle',
            cursor: 'pointer',
            backgroundColor: style.bg,
            color: style.fg,
            border: isLimited ? '2px dotted #000' : (likely ? '2px dashed #555' : 'none'),
            boxShadow: isLimited ? '0 0 0 2px #ff4f4f' : (tier.includes('+') ? '0 0 0 2px gold' : 'none'),
            opacity: likely || isLimited ? '0.85' : '1'
        });

        badge.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            showPopup(result, badge);
        });
        return badge;
    }

    function showPopup(result, anchor) {
        const old = document.getElementById('psu-tier-popup');
        if (old) old.remove();

        const data = result.entry;
        const popup = document.createElement('div');
        popup.id = 'psu-tier-popup';
        Object.assign(popup.style, {
            position: 'absolute', backgroundColor: '#1a1a1a', color: '#fff',
            padding: '15px', borderRadius: '8px', boxShadow: '0 4px 15px rgba(0,0,0,0.5)',
            zIndex: '999999', minWidth: '300px', maxWidth: '420px',
            fontFamily: 'sans-serif', fontSize: '14px', lineHeight: '1.4',
            border: '1px solid #444'
        });

        const rows = [
            ['Brand', data.brand], ['Series', data.series], ['Model', data.model],
            ['Wattage', data.wattage], ['Year', data.year], ['Form factor', data.form_factor],
            ['ATX', data.atx_version], ['Modularity', data.modularity], ['Efficiency', data.efficiency],
            ['Topology', data.topology], ['ODM', data.odm], ['Platform', data.platform],
            ['Notes', data.notes]
        ];

        const esc = (s) => String(s).replace(/[&<>"]/g, (c) =>
            ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

        const confPct = Math.round(result.confidence * 100);
        let html = '';
        if (data.is_limited) {
            html += `<div style="background-color: #ffd966; color: #000; padding: 8px; border-radius: 4px; margin-bottom: 10px; font-weight: bold; font-size: 0.9em; border-left: 5px solid #f29738; line-height: 1.3;">`
                + `⚠️ Limited Confidence Rating<br/>`
                + `<span style="font-weight: normal; font-size: 0.85em;">This rating is speculative due to insufficient data. NOT recommended until more info is available.</span>`
                + `</div>`;
        }
        html += `<h3 style="margin:0 0 8px;border-bottom:1px solid #555;padding-bottom:5px;">`
            + `Tier ${esc(data.tier)}${data.is_limited ? '*' : ''} `
            + `<span style="font-weight:normal;color:#aaa;font-size:0.85em;">`
            + `(${result.band === 'likely' ? 'likely, ' : ''}${confPct}% match)</span></h3>`;
        html += '<div style="display:grid;grid-template-columns:110px 1fr;gap:4px;">';
        for (const [label, val] of rows) {
            if (val == null || String(val).trim() === '') continue;
            html += `<div style="color:#aaa;font-weight:bold;">${esc(label)}:</div><div>${esc(val)}</div>`;
        }
        if (data.is_limited) {
            html += `<div style="color:#ff4f4f;font-weight:bold;">Rating Type:</div><div style="color:#ff4f4f;font-weight:bold;">Limited Confidence (Speculative)</div>`;
        }
        html += '</div>';

        if (result.alternates && result.alternates.length) {
            html += '<div style="margin-top:10px;border-top:1px solid #444;padding-top:6px;color:#bbb;">'
                + '<div style="font-weight:bold;margin-bottom:3px;">Other possible matches:</div>';
            for (const alt of result.alternates) {
                html += `<div style="font-size:0.9em;">Tier ${esc(alt.entry.tier)} - `
                    + `${esc(alt.entry.model)} (${Math.round(alt.confidence * 100)}%)</div>`;
            }
            html += '</div>';
        }
        html += '<div style="margin-top:10px;text-align:right;">'
            + '<button id="psu-popup-close" style="background:#555;color:#fff;border:none;'
            + 'padding:5px 10px;border-radius:4px;cursor:pointer;">Close</button></div>';
        popup.innerHTML = html;
        document.body.appendChild(popup);

        const rect = anchor.getBoundingClientRect();
        popup.style.top = (rect.bottom + window.scrollY + 5) + 'px';
        popup.style.left = (rect.left + window.scrollX) + 'px';

        popup.querySelector('#psu-popup-close').onclick = () => popup.remove();
        setTimeout(() => {
            const handler = (e) => {
                if (!popup.contains(e.target)) {
                    popup.remove();
                    document.removeEventListener('click', handler);
                }
            };
            document.addEventListener('click', handler);
        }, 10);
    }

    // --- Main loop ----------------------------------------------------------

    function addBadges(adapter) {
        for (const row of document.querySelectorAll(adapter.selector)) {
            if (row.dataset.psuTierDone) continue;
            if (adapter.filter && !adapter.filter(row)) continue;

            const signals = adapter.extract(row);
            if (!signals || !signals.name) continue;
            row.dataset.psuTierDone = '1';

            const result = PSUMatcher.match(signals.name, signals, index, RULES);
            if (result) adapter.insertBadge(row, makeBadge(result));
        }
    }

    const adapter = PSUAdapters.activeAdapter();
    if (adapter) {
        addBadges(adapter);
        let scheduled = false;
        const observer = new MutationObserver(() => {
            if (scheduled) return;
            scheduled = true;
            requestAnimationFrame(() => { scheduled = false; addBadges(adapter); });
        });
        observer.observe(document.body, { childList: true, subtree: true });
    }
})();
