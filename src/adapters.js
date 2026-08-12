/*
 * Site adapters - the only site-specific code. Each adapter knows how to find
 * product rows, pull a name + wattage out of one, and (optionally) where the
 * tier filter can dock into the site's own filter sidebar. To support a new
 * site, add one entry here.
 *
 * `filterDock.render` mirrors the host site's own filter-group markup so the
 * docked panel inherits its theming and spacing. Whatever markup it returns
 * MUST carry these ids, which are the contract with the panel logic in the
 * userscript template:
 *   psu-filter-group   the group wrapper
 *   psu-filter-tier    <select> of minimum tiers
 *   psu-filter-lc      "hide speculative" checkbox
 *   psu-filter-un      "hide unrated" checkbox
 *   psu-filter-popout  button that undocks the panel
 * It must also render `spec.note` verbatim, so the filter is never mistaken
 * for one of the host site's own.
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

  const EFF_LEVELS = ['gold', 'bronze', 'silver', 'platinum', 'titanium', 'white', 'standard'];

  // True for a cell that is nothing but efficiency grades, e.g. "Gold" or
  // "Gold, Platinum" (an 80 PLUS grade plus a Cybenetics ETA grade). Anything
  // with other words in it is a spec sentence, not the certification column.
  function isEfficiencyList(text) {
    const parts = String(text || '').split(/[,/]/).map((p) => p.trim().toLowerCase());
    return parts.length > 0 && parts.every((p) => EFF_LEVELS.indexOf(p) !== -1);
  }

  const LINK_BUTTON = 'background:none;border:none;padding:0;font:inherit;'
    + 'cursor:pointer;text-decoration:underline;';

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
      // Keep the badge on the product-name line rather than appending it to the
      // cell: the cell's children are block/table-cell level, so a trailing
      // badge starts a new line and makes every row taller. The 48px product
      // thumbnail already sets the row height, so an inline badge is free.
      insertBadge: (row, badge) => {
        const cell = row.querySelector('td.td__name');
        if (!cell) return;
        const target = cell.querySelector('.td__nameWrapper p')
          || cell.querySelector('.td__nameWrapper')
          || cell.querySelector('a')
          || cell;
        target.appendChild(badge);
      },
      /*
       * Desktop only: park the badge against the right edge of the Name column
       * instead of trailing the name text. Widening the product link to fill
       * the cell gives the name paragraph the column's full width, so `auto`
       * left margin pushes the badge over to the Type column - calmer to read,
       * and the name no longer wraps just to make room for the badge.
       *
       * Below 1201px PCPartPicker restacks each row into a grid where the Name
       * cell is only as wide as the name, so the badge stays inline there.
       * Scoped to .productList--detailed so /list/ pages are untouched.
       */
      styles: '@media only screen and (min-width:1201px){'
        + 'table.productList--detailed tr td.td__name>a{width:100%;}'
        + 'table.productList--detailed tr td.td__name .td__nameWrapper>p'
        + '{display:flex;align-items:center;gap:8px;}'
        + 'table.productList--detailed tr td.td__name .psu-tier-badge'
        + '{margin-left:auto;flex:none;}'
        + '}',
      siteName: 'PCPartPicker',
      filterDock: {
        // Their sidebar filter groups, e.g. Price / Manufacturer / Rating.
        anchor: () => document.querySelector('div.group--filter[id^="filterdiv_"]'),
        render: (spec, tierOptions) => ''
          + '<div class="group group--filter" id="psu-filter-group">'
          + `<h3 class="group__title group__title--trigger js-trigger-filter">${spec.title}`
          + '<span class="collapse-toggle"></span></h3>'
          + '<ul class="group__content list-unstyled filter-list">'
          + `<li style="opacity:0.7;font-size:0.6875rem;line-height:1.3;margin-bottom:0.5rem;">${spec.note}</li>`
          + `<li style="margin-bottom:0.5rem;"><label for="psu-filter-tier" style="display:block;margin-bottom:0.25rem;">${spec.minLabel}</label>`
          + `<select id="psu-filter-tier" class="select--small">${tierOptions}</select></li>`
          + '<li><input type="checkbox" class="checkbox" id="psu-filter-lc">'
          + `<label for="psu-filter-lc">${spec.lcLabel}</label></li>`
          + '<li><input type="checkbox" class="checkbox" id="psu-filter-un">'
          + `<label for="psu-filter-un">${spec.unLabel}</label></li>`
          + `<li class="moreless"><button type="button" id="psu-filter-popout" style="${LINK_BUTTON}color:inherit;">${spec.popOut}</button></li>`
          + '</ul></div>'
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
        let effList = null;      // the dedicated certification cell (preferred)
        let effProse = null;     // a rating mentioned inside the spec sentence
        let modular = null;
        for (const s of row.querySelectorAll('.spec, td, .specline, .spec-line')) {
          const t = cleanText(s);
          const wm = t.match(/\b([\d.]+)\s*W\b/i);
          if (wm && !wattage) wattage = parseInt(wm[1].replace(/\./g, ''), 10);
          // Tweakers' certification column lists every grade a unit holds,
          // comma-separated, mixing 80 PLUS with Cybenetics ETA - "Gold" but
          // also "Gold, Platinum". Accept the whole list; the matcher treats it
          // as a set of acceptable levels. Requiring a single exact word here
          // used to drop the signal entirely on dual-certified units.
          if (!effList && isEfficiencyList(t)) effList = t;
          if (!effProse && /(80\s*plus|80\+|cybenetics)/i.test(t)) effProse = t;
          if (!modular) {
            if (/volledig\s*modulair/i.test(t)) modular = 'Full';
            else if (/semi\s*-\s*modulair/i.test(t)) modular = 'Semi';
            else if (/niet\s*-\s*modulair/i.test(t)) modular = 'No';
          }
        }
        return {
          name: name,
          formFactor: null,
          efficiency: effList || effProse,
          // Kept alongside: the prose names the certifying body, which decides
          // how strictly the matcher reads the grade.
          efficiencyNote: effProse,
          wattage: wattage,
          modular: modular
        };
      },
      // Alongside the "vergelijk" button. That cell is its own grid area, so
      // the badge sits in space the row already reserves instead of competing
      // with the product name or the spec line.
      insertBadge: (row, badge) => {
        const compare = row.querySelector('.item-body > span.compare');
        if (compare) { compare.appendChild(badge); return; }
        const el = row.querySelector('a.editionName, .productListItemName a');
        if (el) el.after(badge); else row.appendChild(badge);
      },
      // The compare button is a block-level box, so a badge appended after it
      // would start its own line and make every row ~18px taller. A flex row
      // seats them side by side, and the button's 30px height already sets the
      // cell height so the badge costs nothing.
      styles: 'ul.item-listing li .item-body>span.compare'
        + '{display:flex;align-items:center;gap:8px;}'
        + 'ul.item-listing li .item-body>span.compare>.psu-tier-badge{margin-left:0;}',
      siteName: 'Tweakers',
      filterDock: {
        // Sits at the top of the "Verfijn resultaten" column, deliberately
        // outside <form id="filterForm"> so it can't perturb their own filter
        // serialisation. Inputs are name-less for the same reason.
        anchor: () => {
          const form = document.querySelector('#filter form#filterForm');
          return form || document.querySelector('#filter .filterGroup');
        },
        render: (spec, tierOptions) => ''
          + '<div class="filterGroup" id="psu-filter-group">'
          // Their own group headings are display:none on desktop (they only
          // show in the responsive full-focus view). Ours has to stay visible,
          // since it's what marks the group as not being one of theirs.
          + `<h3 class="ellipsis" style="display:block;">${spec.title}</h3>`
          + '<div class="filters">'
          + '<div class="filterOption primary"><div class="options">'
          + `<p style="opacity:0.7;font-size:0.75rem;line-height:1.3;margin:0 0 0.5rem;">${spec.note}</p>`
          + `<h4 class="ellipsis">${spec.minLabel}</h4>`
          + `<select id="psu-filter-tier">${tierOptions}</select>`
          + '<ul>'
          + '<li><label for="psu-filter-lc" class="checkbox"><span class="inputWrapper">'
          + '<input type="checkbox" id="psu-filter-lc"></span>'
          + `<span class="facetLabel">${spec.lcLabel}</span></label></li>`
          + '<li><label for="psu-filter-un" class="checkbox"><span class="inputWrapper">'
          + '<input type="checkbox" id="psu-filter-un"></span>'
          + `<span class="facetLabel">${spec.unLabel}</span></label></li>`
          + '</ul>'
          + `<p style="margin:0.5rem 0 0;"><button type="button" id="psu-filter-popout" style="${LINK_BUTTON}color:inherit;opacity:0.8;">${spec.popOut}</button></p>`
          + '</div></div></div></div>'
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
