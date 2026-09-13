/**
 * PSU Tier Badges — PCPartPicker Zero-Ban In-Browser Console Auditor
 *
 * Runs inside DevTools Console on https://pcpartpicker.com/products/power-supply/
 * Makes ZERO network requests. Inspects active DOM and extension badges.
 *
 * Usage:
 *   1. Open https://pcpartpicker.com/products/power-supply/ in your regular Chrome browser.
 *   2. Press F12 -> Console -> Paste this entire snippet and press Enter.
 *   3. To copy results for offline analysis: run `copy(JSON.stringify(window.__PCPP_AUDIT_DUMP__, null, 2))`
 */
(() => {
  const cleanText = (el) => {
    if (!el) return '';
    const clone = el.cloneNode(true);
    clone.querySelectorAll('.psu-tier-badge').forEach((b) => b.remove());
    return clone.textContent.replace(/\s+/g, ' ').trim();
  };
  const parseWatt = (text) => {
    const n = parseInt(String(text).replace(/[^\d]/g, ''), 10);
    return isNaN(n) ? 0 : n;
  };

  const rows = [...document.querySelectorAll('tr.tr__product')];
  if (!rows.length) {
    console.warn('[PSU Auditor] No PCPartPicker product rows found. Ensure you are on https://pcpartpicker.com/products/power-supply/');
    return;
  }

  const items = rows.map((row, idx) => {
    const nameEl = row.querySelector('.td__nameWrapper p')
      || row.querySelector('.td__nameWrapper')
      || row.querySelector('td.td__name a')
      || row.querySelector('td.td__name');
    const name = cleanText(nameEl);
    if (!name) return null;

    const spec = (n, label) => {
      const c = row.querySelector('td.td__spec--' + n);
      return c ? cleanText(c).replace(label, '').trim() || null : null;
    };

    const formFactor = spec(1, /^Type\s*/i);
    const efficiency = spec(2, /^Efficiency Rating\s*/i);
    const wattage = parseWatt(spec(3, /^Wattage\s*/i));
    const modular = spec(4, /^Modular\s*/i);

    const badgeEl = row.querySelector('.psu-tier-badge');
    const badgeText = badgeEl ? badgeEl.textContent.trim() : null;
    const badgeTitle = badgeEl ? badgeEl.getAttribute('title') : null;

    let status = 'OK';
    let details;

    if (!badgeEl) {
      status = 'UNRATED';
      details = 'No badge injected by extension';
    } else if (badgeText && badgeText.includes('?')) {
      status = 'LIKELY';
      details = badgeTitle || 'Likely / speculative match';
    } else {
      details = badgeTitle || 'Confident match';
    }

    return {
      idx: idx + 1,
      name,
      wattage,
      efficiency,
      formFactor,
      modular,
      hasBadge: !!badgeEl,
      badgeText,
      badgeTitle,
      status,
      details
    };
  }).filter(Boolean);

  const total = items.length;
  const strong = items.filter((i) => i.status === 'OK').length;
  const likely = items.filter((i) => i.status === 'LIKELY').length;
  const unrated = items.filter((i) => i.status === 'UNRATED').length;

  console.log('=======================================================');
  console.log(`[PSU Tier Auditor] Audited ${total} PCPartPicker listings`);
  console.log(`  Strong matches:    ${strong} (${((strong / total) * 100).toFixed(1)}%)`);
  console.log(`  Likely matches:    ${likely} (${((likely / total) * 100).toFixed(1)}%)`);
  console.log(`  Unrated listings:  ${unrated} (${((unrated / total) * 100).toFixed(1)}%)`);
  console.log('=======================================================');

  console.table(
    items.map((i) => ({
      '#': i.idx,
      Name: i.name.slice(0, 35),
      Watt: i.wattage ? `${i.wattage}W` : '-',
      Eff: i.efficiency || '-',
      Badge: i.badgeText || 'NONE',
      Status: i.status
    }))
  );

  window.__PCPP_AUDIT_DUMP__ = {
    url: location.href,
    timestamp: new Date().toISOString(),
    summary: { total, strong, likely, unrated },
    items
  };

  console.log('Snapshot saved to window.__PCPP_AUDIT_DUMP__. Run copy(JSON.stringify(window.__PCPP_AUDIT_DUMP__, null, 2)) to copy to clipboard for offline analysis.');
})();
