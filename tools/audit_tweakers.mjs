/**
 * Agent-driven live browser auditor for Tweakers.net
 *
 * Runs a headed browser on the user's laptop, loads the unpacked extension,
 * navigates Tweakers Pricewatch, inspects all product rows and badges,
 * and produces a diagnostic report on mismatches, likely/uncertain matches,
 * and unrated units.
 *
 * Usage:
 *   node tools/audit_tweakers.mjs [--pages=1] [--cdp=http://localhost:9222]
 */
import { chromium } from 'playwright';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const extPath = path.resolve(root, 'dist-extension');
const profileDir = path.resolve(__dirname, '.chrome-test-profile');

// Load matcher engine and rules for diagnostic comparison
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const matcher = require('../src/matcher.js');
const psuData = JSON.parse(fs.readFileSync(path.join(root, 'psu_data.json'), 'utf8'));
const rules = JSON.parse(fs.readFileSync(path.join(root, 'data/normalization_rules.json'), 'utf8'));
const index = matcher.buildIndex(psuData, rules);

const args = process.argv.slice(2);
const opt = (name, def) => {
  const hit = args.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : def;
};
const numPages = parseInt(opt('pages', '1'), 10);
const cdpEndpoint = opt('cdp', null);

async function getBrowserContext() {
  if (cdpEndpoint) {
    console.log(`Connecting to existing browser via CDP at ${cdpEndpoint}...`);
    return await chromium.connectOverCDP(cdpEndpoint);
  }

  console.log('Launching interactive headed browser with PSU Tier Badges extension...');
  return await chromium.launchPersistentContext(profileDir, {
    headless: false,
    ignoreDefaultArgs: ['--enable-automation'],
    args: [
      `--disable-extensions-except=${extPath}`,
      `--load-extension=${extPath}`,
      '--disable-blink-features=AutomationControlled',
      '--no-first-run',
      '--no-default-browser-check'
    ],
    viewport: { width: 1440, height: 900 }
  });
}

async function auditPage(page, pageNum) {
  const url = pageNum === 1
    ? 'https://tweakers.net/voedingen/vergelijken/'
    : `https://tweakers.net/voedingen/vergelijken/?page=${pageNum}`;

  console.log(`\nAuditing Tweakers page ${pageNum} (${url})...`);
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
  await page.waitForTimeout(3000);

  // Handle cookie consent if visible or inside iframe
  try {
    await page.waitForSelector('ul.item-listing li, tr.listerTableItem', { timeout: 5000 });
  } catch {
    console.log('Waiting for listing or cookie banner...');
    // Look for consent button in main page
    const consentSelectors = [
      'button:has-text("Akkoord")',
      'button:has-text("Accepteren")',
      'button:has-text("Alles accepteren")',
      'button[name="action"][value="accept"]',
      '#cmp-container button.primary'
    ];
    for (const sel of consentSelectors) {
      const btn = page.locator(sel);
      if (await btn.isVisible().catch(() => false)) {
        console.log(`Clicking consent button: ${sel}`);
        await btn.first().click();
        await page.waitForTimeout(2000);
        break;
      }
    }
    // Check if consent is inside an iframe
    for (const frame of page.frames()) {
      for (const sel of consentSelectors) {
        const fBtn = frame.locator(sel);
        if (await fBtn.isVisible().catch(() => false)) {
          console.log(`Clicking consent button in iframe: ${sel}`);
          await fBtn.first().click();
          await page.waitForTimeout(2000);
          break;
        }
      }
    }
    await page.waitForSelector('ul.item-listing li, tr.listerTableItem', { timeout: 20000 });
  }
  await page.waitForTimeout(2000);

  // Collect row data directly from DOM
  const rawRows = await page.evaluate(() => {
    const rows = [...document.querySelectorAll('ul.item-listing li, tr.listerTableItem')];
    return rows.map((row, idx) => {
      const nameEl = row.querySelector('a.editionName, .productListItemName a');
      const name = nameEl ? nameEl.textContent.trim() : null;
      if (!name) return null;

      const badgeEl = row.querySelector('.psu-tier-badge');
      const badgeText = badgeEl ? badgeEl.textContent.trim() : null;
      const badgeTitle = badgeEl ? badgeEl.getAttribute('title') : null;

      // Extract specs from row matching src/adapters.js
      const EFF_LEVELS = ['gold', 'bronze', 'silver', 'platinum', 'titanium', 'white', 'standard'];
      function isEffList(text) {
        const parts = String(text || '').split(/[,/]/).map((p) => p.trim().toLowerCase());
        return parts.length > 0 && parts.every((p) => EFF_LEVELS.indexOf(p) !== -1);
      }

      let wattage = 0;
      let effList = null;
      let effProse = null;
      let modular = null;
      for (const s of row.querySelectorAll('.spec, td, .specline, .spec-line')) {
        const t = s.textContent.replace(/\s+/g, ' ').trim();
        const wm = t.match(/\b([\d.]+)\s*W\b/i);
        if (wm && !wattage) wattage = parseInt(wm[1].replace(/\./g, ''), 10);
        if (!effList && isEffList(t)) effList = t;
        if (!effProse && /(80\s*plus|80\+|cybenetics)/i.test(t)) effProse = t;
        if (!modular) {
          if (/volledig\s*modulair/i.test(t)) modular = 'Full';
          else if (/semi\s*-\s*modulair/i.test(t)) modular = 'Semi';
          else if (/niet\s*-\s*modulair/i.test(t)) modular = 'No';
        }
      }

      return {
        idx: idx + 1,
        name,
        wattage,
        efficiency: effList || effProse,
        efficiencyNote: effProse,
        modular,
        hasBadge: !!badgeEl,
        badgeText,
        badgeTitle
      };
    }).filter(Boolean);
  });

  console.log(`Found ${rawRows.length} product rows on page ${pageNum}.`);

  const results = [];
  for (const item of rawRows) {
    // Run offline matcher diagnostics to understand the match
    const signals = { wattage: item.wattage, efficiency: item.efficiency, modular: item.modular };
    const m = matcher.match(item.name, signals, index, rules);

    let status = 'OK';
    let details = '';

    if (!item.hasBadge) {
      status = 'UNRATED';
      details = m ? `Matcher found ${m.entry.model} (${m.entry.tier}) @ ${Math.round(m.confidence * 100)}%, but extension missed it!` : 'No match in tier database';
    } else if (item.badgeText.includes('?')) {
      status = 'LIKELY';
      details = m ? `Score ${Math.round(m.confidence * 100)}% on ${m.entry.model} (${m.entry.tier})` : 'Likely match';
    } else if (m && m.contested) {
      status = 'CONTESTED';
      details = `Tied across tiers! Alternates: ${m.alternates.map(a => `${a.entry.model} (${a.entry.tier})`).join(', ')}`;
    }

    results.push({
      ...item,
      matcherTier: m ? m.entry.tier : null,
      matcherModel: m ? m.entry.model : null,
      matcherConf: m ? Math.round(m.confidence * 100) : 0,
      status,
      details
    });
  }

  return results;
}

async function main() {
  const context = await getBrowserContext();
  /** @type {import('playwright').Page} */
  let page;
  if ('pages' in context) {
    page = context.pages()[0] || (await context.newPage());
  } else {
    page = context.contexts()[0]?.pages()[0] || (await context.newPage());
  }

  const allItems = [];
  for (let p = 1; p <= numPages; p++) {
    const pageItems = await auditPage(page, p);
    allItems.push(...pageItems);
  }

  console.log('\n================ AUDIT SUMMARY ================');
  const total = allItems.length;
  const strong = allItems.filter(i => i.status === 'OK').length;
  const likely = allItems.filter(i => i.status === 'LIKELY').length;
  const contested = allItems.filter(i => i.status === 'CONTESTED').length;
  const unrated = allItems.filter(i => i.status === 'UNRATED').length;

  console.log(`Total listings audited: ${total}`);
  console.log(`  Strong matches:   ${strong} (${((strong / total) * 100).toFixed(1)}%)`);
  console.log(`  Likely / (?) matches: ${likely} (${((likely / total) * 100).toFixed(1)}%)`);
  console.log(`  Contested matches:    ${contested} (${((contested / total) * 100).toFixed(1)}%)`);
  console.log(`  Unrated listings:     ${unrated} (${((unrated / total) * 100).toFixed(1)}%)`);

  if (likely > 0 || contested > 0 || unrated > 0) {
    console.log('\n--- ATTENTION NEEDED / WEAK POINTS ---');
    for (const item of allItems.filter(i => i.status !== 'OK')) {
      console.log(`[${item.status}] "${item.name}"`);
      console.log(`  Badge: ${item.badgeText || 'NONE'} | Title: ${item.badgeTitle || '-'}`);
      console.log(`  Diagnosis: ${item.details}`);
    }
  }

  // Save audit report to JSON
  const reportPath = path.join(root, 'tools', 'tweakers_audit_report.json');
  fs.writeFileSync(reportPath, JSON.stringify({ summary: { total, strong, likely, contested, unrated }, items: allItems }, null, 2));
  console.log(`\nDetailed report saved to: ${reportPath}`);

  await context.close();
}

main().catch(err => {
  console.error('Audit failed:', err);
  process.exit(1);
});
