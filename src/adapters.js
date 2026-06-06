/*
 * Site adapters - the only site-specific code. Each adapter knows how to find
 * product rows and pull a name + wattage out of one. To support a new site,
 * add one entry here.
 *
 * Like matcher.js this is consumed two ways: inlined into the userscript (where
 * `document`/`location` are the page globals) and required by tests/test_adapters.js
 * (which provides them via linkedom). So it references `document`/`location`
 * freely and keeps `module.exports` guarded.
 */
(function (root) {
  'use strict';

  function cleanText(el) {
    return el ? el.textContent.replace(/\s+/g, ' ').trim() : '';
  }

  function parseWatt(text) {
    const n = parseInt(String(text).replace(/[^\d]/g, ''), 10);
    return isNaN(n) ? 0 : n;
  }

  const ADAPTERS = [
    {
      id: 'pcpartpicker',
      match: () => location.hostname.indexOf('pcpartpicker') !== -1,
      selector: 'tr.tr__product',
      filter: (row) => {
        if (location.pathname.indexOf('/list/') === -1) return true;
        const cell = row.querySelector('td.td__component');
        return !!(cell && cell.innerHTML.indexOf('/products/power-supply/') !== -1);
      },
      // PCPartPicker exposes structured spec columns; using them (efficiency,
      // form factor, canonical wattage) is far more reliable than parsing the
      // name. Each spec cell text is prefixed with its column label.
      extract: (row) => {
        const cell = row.querySelector('td.td__name');
        if (!cell) return null;
        const nameEl = cell.querySelector('.td__nameWrapper p')
          || cell.querySelector('.td__nameWrapper') || cell;
        const name = cleanText(nameEl);
        if (!name) return null;
        const spec = (n, label) => {
          const c = row.querySelector('td.td__spec--' + n);
          return c ? cleanText(c).replace(label, '').trim() || null : null;
        };
        return {
          name: name,
          formFactor: spec(1, /^Type\s*/i),
          efficiency: spec(2, /^Efficiency Rating\s*/i),
          wattage: parseWatt(spec(3, /^Wattage\s*/i)),
          modular: spec(4, /^Modular\s*/i)
        };
      },
      insertBadge: (row, badge) => {
        const cell = row.querySelector('td.td__name');
        if (cell) cell.appendChild(badge);
      }
    },
    {
      id: 'tweakers',
      match: () => location.hostname.indexOf('tweakers') !== -1,
      selector: 'ul.item-listing li, tr.listerTableItem',
      extract: (row) => {
        const el = row.querySelector('a.editionName, .productListItemName a');
        const name = cleanText(el);
        if (!name) return null;
        let wattage = 0;
        let efficiency = null;
        let modular = null;
        for (const s of row.querySelectorAll('.spec, td, .specline, .spec-line')) {
          const t = cleanText(s);
          const wm = t.match(/\b([\d.]+)\s*W\b/i);
          if (wm && !wattage) wattage = parseInt(wm[1].replace(/\./g, ''), 10);
          if (!efficiency) {
            if (/(80\s*plus|80\+)/i.test(t)) {
              efficiency = t;
            } else {
              const cleaned = t.trim().toLowerCase();
              if (['gold', 'bronze', 'silver', 'platinum', 'titanium', 'white', 'standard'].includes(cleaned)) {
                efficiency = t;
              }
            }
          }
          if (!modular) {
            if (/volledig\s*modulair/i.test(t)) modular = 'Full';
            else if (/semi\s*-\s*modulair/i.test(t)) modular = 'Semi';
            else if (/niet\s*-\s*modulair/i.test(t)) modular = 'No';
          }
        }
        return { name: name, formFactor: null, efficiency: efficiency, wattage: wattage, modular: modular };
      },
      insertBadge: (row, badge) => {
        const el = row.querySelector('a.editionName, .productListItemName a');
        if (el) el.after(badge); else row.appendChild(badge);
      }
    }
  ];

  function activeAdapter() {
    return ADAPTERS.find((a) => a.match()) || null;
  }

  const api = { ADAPTERS, activeAdapter };
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else {
    /** @type {any} */ (root).PSUAdapters = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this);
