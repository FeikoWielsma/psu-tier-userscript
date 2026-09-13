/**
 * Safe, Anti-Ban PCPartPicker Auditor for PSU Tier Badges
 *
 * Designed to eliminate Cloudflare IP bans:
 *  - Connects to existing user browser over CDP (--cdp=http://localhost:9222)
 *  - Passive tab inspection by default (no forced navigation / reload)
 *  - Cloudflare Turnstile / challenge detection with human pause
 *  - Offline dump / fixture mode (--from-dump=file.json or --fixture=file.html)
 *
 * Usage:
 *   # 1. Passive audit of open PCPP tab in user's Chrome:
 *   node tools/audit_pcpp.mjs --cdp=http://localhost:9222
 *
 *   # 2. Offline audit from dumped JSON (zero network):
 *   node tools/audit_pcpp.mjs --from-dump=tools/pcpp_dump.json
 *
 *   # 3. Offline audit from HTML fixture:
 *   node tools/audit_pcpp.mjs --fixture=tests/fixtures/pcpp-list-01.html
 */
import { chromium } from 'playwright';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import http from 'http';
import os from 'os';
import { spawn } from 'child_process';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');

// Load offline matcher engine and rules
const matcher = require('../src/matcher.js');
const psuData = JSON.parse(fs.readFileSync(path.join(root, 'psu_data.json'), 'utf8'));
const rules = JSON.parse(fs.readFileSync(path.join(root, 'data/normalization_rules.json'), 'utf8'));
const index = matcher.buildIndex(psuData, rules);

const args = process.argv.slice(2);
const opt = (name, def) => {
  const hit = args.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : def;
};
const hasFlag = (name) => args.some((a) => a === `--${name}` || a.startsWith(`--${name}=`));

const cdpEndpoint = opt('cdp', null);
const fromDump = opt('from-dump', null);
const fixturePath = opt('fixture', null);
const numPages = parseInt(opt('pages', '2'), 10);
const isAuto = hasFlag('auto');

function evaluateExtractedItems(rawRows, isFixture = false) {
  const results = [];
  for (const item of rawRows) {
    const cleanName = item.name.replace(/\s*Tier\s*[A-F][-+*]*(?:\s*\(LC\))?\??\s*$/i, '').trim();
    const signals = {
      wattage: item.wattage,
      efficiency: item.efficiency,
      modular: item.modular,
      formFactor: item.formFactor
    };
    const m = matcher.match(cleanName, signals, index, rules);

    let status = 'OK';
    let details;

    if (!item.hasBadge && !isFixture) {
      if (m) {
        status = 'MISSED_BY_EXT';
        details = `Matcher found ${m.entry.model} (${m.entry.tier}) @ ${Math.round(m.confidence * 100)}%, but extension rendered no badge!`;
      } else {
        status = 'UNRATED';
        details = 'No match in tier database';
      }
    } else if (!m) {
      status = 'UNRATED';
      details = 'No match in tier database';
    } else if (m.contested) {
      status = 'CONTESTED';
      details = `Tied across tiers! Alternates: ${m.alternates.map((a) => `${a.entry.model} (${a.entry.tier})`).join(', ')}`;
    } else if (m.band === 'likely' || (item.badgeText && item.badgeText.includes('?'))) {
      status = 'LIKELY';
      details = `Score ${Math.round(m.confidence * 100)}% on ${m.entry.model} (${m.entry.tier})`;
    } else if (item.badgeText && !item.badgeText.includes(m.entry.tier)) {
      status = 'TIER_MISMATCH';
      details = `Badge says "${item.badgeText}", but matcher found "${m.entry.tier}" (${m.entry.model})`;
    } else {
      details = `${m.entry.model} (${Math.round(m.confidence * 100)}%)`;
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

function runOfflineDump(filePath) {
  console.log(`\nLoading audit dump from ${filePath}...`);
  let rawText = fs.readFileSync(filePath, 'utf8').trim();
  const start = rawText.indexOf('{');
  const end = rawText.lastIndexOf('}');
  if (start !== -1 && end !== -1) {
    rawText = rawText.substring(start, end + 1);
  }
  const data = JSON.parse(rawText);
  const rawRows = Array.isArray(data) ? data : data.items;
  return evaluateExtractedItems(rawRows);
}

function runFixture(filePath) {
  console.log(`\nParsing HTML fixture from ${filePath}...`);
  const { parseHTML } = require('linkedom');
  const html = fs.readFileSync(filePath, 'utf8');
  const { document } = parseHTML(html);

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
  const rawRows = rows.map((row, idx) => {
    const nameEl = row.querySelector('.td__nameWrapper p')
      || row.querySelector('.td__nameWrapper')
      || row.querySelector('td.td__name a');
    const name = cleanText(nameEl);
    if (!name) return null;

    const spec = (n, label) => {
      const c = row.querySelector('td.td__spec--' + n);
      return c ? cleanText(c).replace(label, '').trim() || null : null;
    };

    const badgeEl = row.querySelector('.psu-tier-badge');
    return {
      idx: idx + 1,
      name,
      formFactor: spec(1, /^Type\s*/i),
      efficiency: spec(2, /^Efficiency Rating\s*/i),
      wattage: parseWatt(spec(3, /^Wattage\s*/i)),
      modular: spec(4, /^Modular\s*/i),
      hasBadge: !!badgeEl,
      badgeText: badgeEl ? badgeEl.textContent.trim() : null,
      badgeTitle: badgeEl ? badgeEl.getAttribute('title') : null
    };
  }).filter(Boolean);

  return evaluateExtractedItems(rawRows, true);
}

function checkCdp(endpoint) {
  return new Promise((resolve) => {
    try {
      const u = new URL(endpoint);
      const req = http.get(
        {
          host: u.hostname,
          port: u.port || 9222,
          path: '/json/version',
          timeout: 1500
        },
        (res) => {
          resolve(res.statusCode === 200);
        }
      );
      req.on('error', () => resolve(false));
      req.on('timeout', () => {
        req.destroy();
        resolve(false);
      });
    } catch {
      resolve(false);
    }
  });
}

function findChromePath() {
  const candidates = [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    path.join(process.env.LOCALAPPDATA || '', 'Google', 'Chrome', 'Application', 'chrome.exe'),
    '/usr/bin/google-chrome',
    '/usr/bin/chromium-browser',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
  ];
  return candidates.find((c) => c && fs.existsSync(c));
}

async function autoLaunchChrome(endpoint) {
  const isUp = await checkCdp(endpoint);
  if (isUp) {
    console.log(`Chrome debugging port is already active at ${endpoint}.`);
    return;
  }

  const chromePath = findChromePath();
  if (!chromePath) {
    throw new Error('Chrome executable not found. Please install Google Chrome or pass --cdp=URL.');
  }

  const u = new URL(endpoint);
  const port = u.port || '9222';
  const profileDir = path.join(os.homedir(), '.pcpp-chrome-profile');
  const extDir = path.join(root, 'dist-extension');

  console.log(`\nAuto-launching real Chrome with extension preloaded...`);
  console.log(`  Profile:   ${profileDir}`);
  console.log(`  Extension: ${extDir}`);
  console.log(`  Port:      ${port}`);

  const chromeArgs = [
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${profileDir}`,
    `--load-extension=${extDir}`,
    '--no-first-run',
    '--no-default-browser-check',
    'https://pcpartpicker.com/products/power-supply/'
  ];

  const proc = spawn(chromePath, chromeArgs, {
    detached: true,
    stdio: 'ignore'
  });
  proc.unref();

  console.log('Waiting for Chrome CDP endpoint to be ready...');
  const start = Date.now();
  while (Date.now() - start < 20000) {
    await new Promise((r) => setTimeout(r, 600));
    if (await checkCdp(endpoint)) {
      console.log('Chrome CDP is ready!\n');
      return;
    }
  }
  throw new Error(`Timed out waiting for Chrome to start CDP on ${endpoint}`);
}

async function runCdpAudit(endpoint, autoLaunch = false) {
  if (autoLaunch) {
    await autoLaunchChrome(endpoint);
  }
  console.log(`Connecting to browser via CDP at ${endpoint}...`);
  const browser = await chromium.connectOverCDP(endpoint);
  const context = browser.contexts()[0];
  const pages = context ? context.pages() : [];

  // Find an existing PCPartPicker tab
  let page = pages.find((p) => p.url().includes('pcpartpicker.com'));

  if (!page) {
    console.log('No active PCPartPicker tab found. Opening a new tab to power-supply listings...');
    page = context ? await context.newPage() : await browser.newPage();
    await page.goto('https://pcpartpicker.com/products/power-supply/', { waitUntil: 'domcontentloaded', timeout: 60000 });
  } else {
    console.log(`Using existing PCPartPicker tab: ${page.url()}`);
  }

  // Check for Cloudflare challenge
  const title = await page.title();
  const isChallenge = /just a moment|attention required|cloudflare/i.test(title);
  if (isChallenge) {
    console.warn('\n⚠️ Cloudflare challenge detected on page!');
    console.warn('👉 Please complete the verification in your open Chrome browser window.');
    console.log('Waiting for product table to appear...');
    await page.waitForSelector('tr.tr__product', { timeout: 120000 });
    console.log('Challenge cleared! Proceeding with audit.');
  }

  const allItems = [];

  for (let p = 1; p <= numPages; p++) {
    if (p > 1) {
      console.log(`\nNavigating safely to page ${p} with humanized delay...`);
      // Random jitter delay (6-9s) to mimic human browsing and prevent rate limit
      const jitterMs = 6000 + Math.floor(Math.random() * 3000);
      console.log(`Pacing wait: ${(jitterMs / 1000).toFixed(1)}s...`);
      await page.waitForTimeout(jitterMs);

      const prevFirstName = await page.$eval('tr.tr__product td.td__name', (el) => el.textContent.trim()).catch(() => '');
      const nextUrl = `https://pcpartpicker.com/products/power-supply/#page=${p}`;

      const pageLink = (await page.$(`a[href*="#page=${p}"]`)) || (await page.$(`a[href*="page=${p}"]`));
      if (pageLink) {
        console.log(`Clicking pagination link for page ${p}...`);
        await pageLink.click();
      } else {
        console.log(`Navigating directly to ${nextUrl}...`);
        await page.goto(nextUrl, { waitUntil: 'domcontentloaded', timeout: 45000 });
      }

      await page.waitForFunction(
        (prev) => {
          const first = document.querySelector('tr.tr__product td.td__name');
          return first && first.textContent.trim() !== prev;
        },
        prevFirstName,
        { timeout: 15000 }
      ).catch(() => {});
      await page.waitForSelector('tr.tr__product', { timeout: 30000 });
      await page.waitForTimeout(1000);
    }

    // Ensure the userscript/extension is active on the page
    const badgeCount = await page.$$eval('.psu-tier-badge', (els) => els.length).catch(() => 0);
    if (badgeCount === 0) {
      const extContentPath = path.join(root, 'dist-extension', 'content.js');
      if (fs.existsSync(extContentPath)) {
        console.log('Injecting userscript/content.js directly into active page context...');
        await page.addScriptTag({ path: extContentPath });
        await page.waitForTimeout(1500);
      }
    }

    const pageOffset = (p - 1) * 100;
    const rawRows = await page.evaluate((offset) => {
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
      return rows.map((row, idx) => {
        const nameEl = row.querySelector('.td__nameWrapper p')
          || row.querySelector('.td__nameWrapper')
          || row.querySelector('td.td__name a');
        const name = cleanText(nameEl);
        if (!name) return null;

        const spec = (n, label) => {
          const c = row.querySelector('td.td__spec--' + n);
          return c ? cleanText(c).replace(label, '').trim() || null : null;
        };

        const badgeEl = row.querySelector('.psu-tier-badge');
        return {
          idx: offset + idx + 1,
          name,
          formFactor: spec(1, /^Type\s*/i),
          efficiency: spec(2, /^Efficiency Rating\s*/i),
          wattage: parseWatt(spec(3, /^Wattage\s*/i)),
          modular: spec(4, /^Modular\s*/i),
          hasBadge: !!badgeEl,
          badgeText: badgeEl ? badgeEl.textContent.trim() : null,
          badgeTitle: badgeEl ? badgeEl.getAttribute('title') : null
        };
      }).filter(Boolean);
    }, pageOffset);

    console.log(`Extracted ${rawRows.length} rows from page ${p}.`);
    const pageItems = evaluateExtractedItems(rawRows);
    allItems.push(...pageItems);
  }

  await browser.close().catch(() => {});
  return allItems;
}

async function main() {
  let items;

  if (fromDump) {
    items = runOfflineDump(fromDump);
  } else if (fixturePath) {
    items = runFixture(fixturePath);
  } else {
    const endpoint = cdpEndpoint || 'http://localhost:9222';
    const auto = isAuto || !cdpEndpoint;
    items = await runCdpAudit(endpoint, auto);
  }

  console.log('\n================ PCPP AUDIT SUMMARY ================');
  const total = items.length;
  const strong = items.filter((i) => i.status === 'OK').length;
  const likely = items.filter((i) => i.status === 'LIKELY').length;
  const unrated = items.filter((i) => i.status === 'UNRATED').length;
  const missed = items.filter((i) => i.status === 'MISSED_BY_EXT').length;
  const mismatch = items.filter((i) => i.status === 'TIER_MISMATCH').length;
  const contested = items.filter((i) => i.status === 'CONTESTED').length;

  console.log(`Total listings audited: ${total}`);
  console.log(`  Strong matches:       ${strong} (${((strong / total) * 100).toFixed(1)}%)`);
  console.log(`  Likely / (?) matches:  ${likely} (${((likely / total) * 100).toFixed(1)}%)`);
  console.log(`  Truly unrated in DB:   ${unrated} (${((unrated / total) * 100).toFixed(1)}%)`);
  if (missed > 0) {
    console.log(`  Missed by extension:   ${missed} (${((missed / total) * 100).toFixed(1)}%) <-- Potential bug!`);
  }
  if (mismatch > 0) {
    console.log(`  Tier mismatches:      ${mismatch} (${((mismatch / total) * 100).toFixed(1)}%)`);
  }
  if (contested > 0) {
    console.log(`  Contested ties:       ${contested} (${((contested / total) * 100).toFixed(1)}%)`);
  }

  const issues = items.filter((i) => i.status !== 'OK');
  if (issues.length > 0) {
    console.log('\n--- ATTENTION NEEDED / WEAK POINTS ---');
    for (const item of issues.slice(0, 30)) {
      console.log(`[${item.status}] "${item.name}"`);
      console.log(`  Specs: ${item.wattage}W | Eff: ${item.efficiency || '-'} | Mod: ${item.modular || '-'}`);
      console.log(`  Badge: ${item.badgeText || 'NONE'} | Diagnosis: ${item.details}`);
    }
  }

  const reportPath = path.join(root, 'tools', 'pcpp_audit_report.json');
  fs.writeFileSync(
    reportPath,
    JSON.stringify(
      {
        summary: { total, strong, likely, unrated, missed, mismatch, contested },
        items
      },
      null,
      2
    )
  );
  console.log(`\nDetailed report written to: ${reportPath}`);
  process.exit(0);
}

main().catch((err) => {
  console.error('PCPP audit failed:', err);
  process.exit(1);
});
