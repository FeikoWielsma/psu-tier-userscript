// ==UserScript==
// @name         PSU Tier Badges (PCPartPicker & Tweakers)
// @namespace    https://github.com/FeikoWielsma/psu-tier-userscript
// @version      2.0.14
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

    /*
     * Badge geometry that a site adapter may need to override lives here rather
     * than in the per-badge inline styles, since inline styles would win over
     * the adapter's stylesheet. Tier colours stay inline - they vary per badge.
     */
    function injectStyles(adapter) {
        if (document.getElementById('psu-tier-styles')) return;
        const el = document.createElement('style');
        el.id = 'psu-tier-styles';
        el.textContent = '.psu-tier-badge{margin-left:8px;}' + (adapter.styles || '');
        (document.head || document.documentElement).appendChild(el);
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
            borderRadius: '4px',
            fontSize: '0.8em',
            fontWeight: 'bold',
            verticalAlign: 'middle',
            cursor: 'pointer',
            // The badge sits inside the product link on PCPartPicker; don't
            // inherit the link's underline or let the text wrap mid-badge.
            textDecoration: 'none',
            whiteSpace: 'nowrap',
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
                const ts = tierStyle(alt.entry.tier);
                html += `<div style="font-size:0.9em;"><span style="color:${ts.bg};font-weight:bold;">Tier ${esc(alt.entry.tier)}</span> - `
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

    // --- Filtering ----------------------------------------------------------

    const TIER_OPTIONS = ['ANY', 'A+', 'A', 'A-', 'B+', 'B', 'B-', 'C+', 'C', 'C-', 'D', 'E', 'F'];
    const PREFS_KEY = 'psuTierFilterPanel';

    let currentFilter = {
        minTier: 'ANY',
        hideLimited: false,
        hideUnrated: false
    };

    // mode: 'docked' sits in the host site's own filter sidebar, 'floating' is
    // the draggable panel. collapsed/left/top only apply while floating.
    let panelPrefs = { mode: 'docked', collapsed: false, left: null, top: null };

    function loadPrefs() {
        try {
            const raw = localStorage.getItem(PREFS_KEY);
            if (raw) Object.assign(panelPrefs, JSON.parse(raw));
        } catch (e) { /* storage blocked or corrupt - keep defaults */ }
    }

    function savePrefs() {
        try { localStorage.setItem(PREFS_KEY, JSON.stringify(panelPrefs)); } catch (e) { /* ignore */ }
    }

    function applyFilters() {
        const ranks = {
            'A+': 100, 'A': 95, 'A-': 90,
            'B+': 80,  'B': 75, 'B-': 70,
            'C+': 60,  'C': 55, 'C-': 50,
            'D': 40,   'E': 30, 'F': 20
        };
        const reqRank = currentFilter.minTier === 'ANY' ? 0 : ranks[currentFilter.minTier];

        const adapter = PSUAdapters.activeAdapter();
        if (!adapter) return;

        for (const row of document.querySelectorAll(adapter.selector)) {
            if (!row.dataset.psuTierDone) continue;

            let show = true;
            const tier = row.dataset.psuTier || 'UNRATED';
            const isLC = row.dataset.psuIsLimited === '1';

            if (currentFilter.hideUnrated && tier === 'UNRATED') {
                show = false;
            } else if (tier !== 'UNRATED') {
                if (currentFilter.hideLimited && isLC) {
                    show = false;
                } else {
                    const rank = ranks[tier] || ranks[tier.replace(/[^A-F]/g, '')] || 0;
                    if (rank < reqRank) show = false;
                }
            }
            
            row.style.display = show ? '' : 'none';
        }
    }

    function tierOptionsHtml() {
        return TIER_OPTIONS.map((t) =>
            `<option value="${t}"${t === currentFilter.minTier ? ' selected' : ''}>${t === 'ANY' ? 'Any' : t}</option>`
        ).join('');
    }

    function bindControls(root) {
        root.querySelector('#psu-filter-lc').checked = currentFilter.hideLimited;
        root.querySelector('#psu-filter-un').checked = currentFilter.hideUnrated;
        root.addEventListener('change', (e) => {
            if (e.target.id === 'psu-filter-tier') currentFilter.minTier = e.target.value;
            else if (e.target.id === 'psu-filter-lc') currentFilter.hideLimited = e.target.checked;
            else if (e.target.id === 'psu-filter-un') currentFilter.hideUnrated = e.target.checked;
            else return;
            applyFilters();
        });
    }

    function filterSpec(adapter) {
        return {
            title: 'PSU Tier Badges',
            // Rendered by every dock. The docked panel wears the host site's
            // own filter styling, so it has to say plainly that it isn't theirs.
            note: `Added by the PSU Tier Badges extension — not a ${adapter.siteName} filter. `
                + 'Ratings come from the SPL PSU Tier List.',
            minLabel: 'Minimum tier',
            lcLabel: 'Hide Speculative (LC)',
            unLabel: 'Hide Unrated',
            popOut: 'Pop out ↗'
        };
    }

    function canDock(adapter) {
        return !!(adapter.filterDock && adapter.filterDock.anchor());
    }

    /*
     * Docked: a group inside the host site's own filter sidebar, built from
     * their markup (see filterDock in adapters.js) so it themes, collapses and
     * scrolls like a native filter instead of floating over the page.
     */
    function mountDockedFilter(adapter) {
        const anchor = canDock(adapter) && adapter.filterDock.anchor();
        if (!anchor || !anchor.parentNode) return false;

        const holder = document.createElement('div');
        holder.innerHTML = adapter.filterDock.render(filterSpec(adapter), tierOptionsHtml());
        const group = holder.firstElementChild;
        if (!group) return false;

        anchor.parentNode.insertBefore(group, anchor);
        bindControls(group);
        group.querySelector('#psu-filter-popout').addEventListener('click', () => {
            setPanelMode('floating', adapter);
        });

        const floating = document.getElementById('psu-filter-ui');
        if (floating) floating.remove();
        return true;
    }

    /* Popped out, and the fallback for pages without a filter sidebar: a
     * floating panel that can be dragged out of the way, collapsed to its title
     * bar, or docked back into the site's sidebar (filters stay applied
     * throughout). Position, collapsed state and mode persist. */
    function mountFloatingFilter(adapter) {
        const container = document.createElement('div');
        container.id = 'psu-filter-ui';
        Object.assign(container.style, {
            position: 'fixed',
            backgroundColor: '#1a1a1a',
            color: '#eee',
            borderRadius: '8px',
            border: '1px solid #444',
            boxShadow: '0 4px 10px rgba(0,0,0,0.5)',
            zIndex: '9999',
            fontFamily: 'sans-serif',
            fontSize: '13px',
            overflow: 'hidden'
        });

        const header = document.createElement('div');
        Object.assign(header.style, {
            display: 'flex', alignItems: 'center', gap: '8px',
            padding: '5px 6px 5px 12px', backgroundColor: '#26262e',
            cursor: 'move', userSelect: 'none', touchAction: 'none'
        });
        const title = document.createElement('strong');
        title.textContent = 'PSU Tier Badges';
        title.style.flex = '1';
        title.style.whiteSpace = 'nowrap';

        const headerButton = () => {
            const b = document.createElement('button');
            b.type = 'button';
            Object.assign(b.style, {
                background: 'none', border: 'none', color: '#eee', cursor: 'pointer',
                fontSize: '14px', lineHeight: '1', padding: '3px 5px'
            });
            return b;
        };
        const dock = headerButton();
        dock.textContent = '⇤';
        dock.title = `Dock into the ${adapter.siteName} filter sidebar`;
        dock.addEventListener('click', () => setPanelMode('docked', adapter));
        const toggle = headerButton();

        header.appendChild(title);
        // Only offer docking where there's actually a sidebar to dock into.
        if (canDock(adapter)) header.appendChild(dock);
        header.appendChild(toggle);

        const body = document.createElement('div');
        Object.assign(body.style, {
            flexDirection: 'column', gap: '8px', padding: '10px 12px 12px'
        });
        body.innerHTML =
            '<label>Min Tier: <select id="psu-filter-tier" style="background:#333;color:#fff;'
            + `border:1px solid #555;border-radius:4px;padding:2px 4px;margin-left:4px;cursor:pointer;">${tierOptionsHtml()}</select></label>`
            + '<label style="cursor:pointer;"><input type="checkbox" id="psu-filter-lc" '
            + 'style="margin-right:4px;cursor:pointer;"> Hide Speculative (LC)</label>'
            + '<label style="cursor:pointer;"><input type="checkbox" id="psu-filter-un" '
            + 'style="margin-right:4px;cursor:pointer;"> Hide Unrated</label>'
            + '<span style="opacity:0.6;font-size:11px;line-height:1.3;">'
            + 'Ratings from the SPL PSU Tier List.</span>';

        container.appendChild(header);
        container.appendChild(body);

        const applyCollapsed = () => {
            body.style.display = panelPrefs.collapsed ? 'none' : 'flex';
            toggle.textContent = panelPrefs.collapsed ? '▸' : '▾';
            toggle.title = panelPrefs.collapsed
                ? 'Show PSU tier filter (filters stay applied)'
                : 'Collapse PSU tier filter (filters stay applied)';
        };
        applyCollapsed();
        toggle.addEventListener('click', () => {
            panelPrefs.collapsed = !panelPrefs.collapsed;
            applyCollapsed();
            savePrefs();
        });

        if (panelPrefs.left != null && panelPrefs.top != null) {
            container.style.left = Math.max(0, Math.min(panelPrefs.left, window.innerWidth - 80)) + 'px';
            container.style.top = Math.max(0, Math.min(panelPrefs.top, window.innerHeight - 30)) + 'px';
        } else {
            container.style.right = '20px';
            container.style.bottom = '20px';
        }

        let drag = null;
        header.addEventListener('pointerdown', (e) => {
            const t = /** @type {any} */ (e.target);
            if (e.button !== 0 || toggle.contains(t) || dock.contains(t)) return;
            const rect = container.getBoundingClientRect();
            drag = { dx: e.clientX - rect.left, dy: e.clientY - rect.top };
            // Switch from the bottom/right anchoring to absolute coordinates.
            Object.assign(container.style, {
                left: rect.left + 'px', top: rect.top + 'px', right: 'auto', bottom: 'auto'
            });
            header.setPointerCapture(e.pointerId);
            e.preventDefault();
        });
        header.addEventListener('pointermove', (e) => {
            if (!drag) return;
            const maxLeft = Math.max(0, window.innerWidth - container.offsetWidth);
            const maxTop = Math.max(0, window.innerHeight - container.offsetHeight);
            panelPrefs.left = Math.max(0, Math.min(e.clientX - drag.dx, maxLeft));
            panelPrefs.top = Math.max(0, Math.min(e.clientY - drag.dy, maxTop));
            container.style.left = panelPrefs.left + 'px';
            container.style.top = panelPrefs.top + 'px';
        });
        const endDrag = (e) => {
            if (!drag) return;
            drag = null;
            try { header.releasePointerCapture(e.pointerId); } catch (err) { /* already released */ }
            savePrefs();
        };
        header.addEventListener('pointerup', endDrag);
        header.addEventListener('pointercancel', endDrag);

        bindControls(container);
        document.body.appendChild(container);
        return true;
    }

    // Which mount is actually on the page right now. This can differ from
    // panelPrefs.mode: a page with no sidebar falls back to floating without
    // overwriting the user's stored preference.
    let filterUiMode = null;

    function setPanelMode(mode, adapter) {
        panelPrefs.mode = mode;
        savePrefs();
        const old = document.getElementById(mode === 'docked' ? 'psu-filter-ui' : 'psu-filter-group');
        if (old) old.remove();
        filterUiMode = null;
        ensureFilterUI(adapter);
        applyFilters();
    }

    function ensureFilterUI(adapter) {
        const id = filterUiMode === 'docked' ? 'psu-filter-group'
            : filterUiMode === 'floating' ? 'psu-filter-ui' : null;
        // Re-mount if the site re-rendered its sidebar out from under us.
        if (id && document.getElementById(id)) return;
        if (panelPrefs.mode === 'docked' && mountDockedFilter(adapter)) filterUiMode = 'docked';
        else if (mountFloatingFilter(adapter)) filterUiMode = 'floating';
    }

    // --- Main loop ----------------------------------------------------------

    function addBadges(adapter) {
        let added = false;
        for (const row of document.querySelectorAll(adapter.selector)) {
            if (row.dataset.psuTierDone) continue;
            if (adapter.filter && !adapter.filter(row)) continue;

            const signals = adapter.extract(row);
            if (!signals || !signals.name) continue;
            row.dataset.psuTierDone = '1';

            const result = PSUMatcher.match(signals.name, signals, index, RULES);
            if (result) {
                adapter.insertBadge(row, makeBadge(result));
                row.dataset.psuTier = result.entry.tier;
                row.dataset.psuIsLimited = result.entry.is_limited ? '1' : '0';
            } else {
                row.dataset.psuTier = 'UNRATED';
            }
            added = true;
        }
        if (added && filterUiMode) applyFilters();
    }

    const adapter = PSUAdapters.activeAdapter();
    if (adapter) {
        injectStyles(adapter);
        const wantsFilter = location.pathname.indexOf('/products/power-supply/') !== -1
            || location.pathname.indexOf('/voedingen/vergelijken/') !== -1;
        if (wantsFilter) {
            loadPrefs();
            ensureFilterUI(adapter);
        }
        addBadges(adapter);
        let scheduled = false;
        const observer = new MutationObserver(() => {
            if (scheduled) return;
            scheduled = true;
            requestAnimationFrame(() => {
                scheduled = false;
                if (wantsFilter) ensureFilterUI(adapter);
                addBadges(adapter);
            });
        });
        observer.observe(document.body, { childList: true, subtree: true });
    }
})();
