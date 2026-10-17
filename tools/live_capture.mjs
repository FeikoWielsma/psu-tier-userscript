/*
 * Local, on-demand live browser tool. NOT for CI.
 *
 *   node tools/live_capture.mjs --capture   # save fresh HTML fixtures
 *   node tools/live_capture.mjs --smoke      # inject the userscript, report matches
 *
 * Options:
 *   --channel=chrome|msedge      use an installed Chromium-family browser
 *   --browser-path="C:\\...\\brave.exe"   use Brave (no Playwright channel exists)
 *   --headed                      show the browser window
 *   --url=<url>                   override/add a target (repeatable)
 *
 * Respectful by design: a handful of normal page loads with a pause between
 * them - not a scraper. Requires `npx playwright install chromium` once (or use
 * --channel / --browser-path to drive an already-installed browser).
 */
import { chromium } from 'playwright';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');

const args = process.argv.slice(2);
const has = (f) => args.includes(f);
const opt = (name, def) => {
  const hit = args.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : def;
};
const extraUrls = args.filter((a) => a.startsWith('--url=')).map((a) => a.slice(6));

const TARGETS = [
  {
    fixture: 'pcpp-power-supply.html',
    url: 'https://pcpartpicker.com/products/power-supply/',
    waitFor: 'tr.tr__product'
  },
  {
    fixture: 'tweakers-voedingen.html',
    url: 'https://tweakers.net/voedingen/vergelijken/',
    waitFor: 'ul.item-listing li, tr.listerTableItem'
  }
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function launch() {
  const launchOpts = { headless: !has('--headed') };
  const channel = opt('channel');
  const browserPath = opt('browser-path');
  if (browserPath) launchOpts.executablePath = browserPath;
  else if (channel) launchOpts.channel = channel;
  return chromium.launch(launchOpts);
}

async function withPage(fn) {
  const browser = await launch();
  const ctx = await browser.newContext({
    userAgent: 'Mozilla/5.0 (psu-tier-userscript dev smoke test)'
  });
  const page = await ctx.newPage();
  try {
    await fn(page);
  } finally {
    await browser.close();
  }
}

async function gotoTarget(page, target) {
  try {
    const response = await page.goto(target.url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    if (response && !response.ok()) return `HTTP ${response.status()}`;
    await page.waitForSelector(target.waitFor, { timeout: 15000 });
    return null;
  } catch (error) {
    return String(error.message || error).split('\n')[0];
  }
}

async function capture() {
  await withPage(async (page) => {
    for (const target of targets()) {
      console.log(`Capturing ${target.url}`);
      const unavailable = await gotoTarget(page, target);
      if (unavailable) {
        console.log(`  INCONCLUSIVE: ${unavailable}`);
        process.exitCode = 2;
        continue;
      }
      const html = await page.content();
      // Captures are unreviewed evidence, never overwrite regression fixtures.
      const directory = join(root, 'reports', 'captures', new Date().toISOString().replace(/[:.]/g, '-'));
      mkdirSync(directory, { recursive: true });
      const out = join(directory, target.fixture);
      writeFileSync(out, html, 'utf8');
      console.log(`  -> ${out} (${html.length} bytes)`);
      await sleep(2000);
    }
  });
}

async function smoke() {
  const scriptPath = join(root, 'psutier.user.js');
  if (!existsSync(scriptPath)) {
    console.error('psutier.user.js not found - run generate_userscript.py first.');
    process.exit(1);
  }
  const userscript = readFileSync(scriptPath, 'utf8');
  const evidence = { checkedAt: new Date().toISOString(), scriptSha256: createHash('sha256').update(userscript).digest('hex'),
    scope: 'Live injection and popup smoke checks only; badge counts do not measure correctness.', targets: [] };

  await withPage(async (page) => {
    for (const target of targets()) {
      console.log(`\nSmoke testing ${target.url}`);
      const unavailable = await gotoTarget(page, target);
      if (unavailable) {
        evidence.targets.push({ url: target.url, status: 'inconclusive', reason: unavailable });
        continue;
      }
      const errors = [];
      const onError = (error) => errors.push(error.message);
      page.on('pageerror', onError);
      await page.evaluate(userscript);
      await sleep(1500);

      const report = await page.evaluate(() => {
        const badges = [...document.querySelectorAll('.psu-tier-badge')];
        const strong = badges.filter((b) => !/\?$/.test(b.textContent)).length;
        const likely = badges.length - strong;
        return { badges: badges.length, strong, likely };
      });
      let popupOpened = false;
      if (report.badges) {
        await page.locator('.psu-tier-badge').first().click();
        popupOpened = await page.locator('[role="dialog"]').isVisible();
        await page.keyboard.press('Escape');
      }
      page.off('pageerror', onError);
      const status = report.badges && popupOpened && !errors.length ? 'passed' : 'failed';
      evidence.targets.push({ url: target.url, status, ...report, popupOpened, errors });
      console.log(`  ${status}: ${report.badges} badges; popup ${popupOpened}; runtime errors ${errors.length}`);
      await sleep(2000);
    }
  });
  mkdirSync(join(root, 'reports'), { recursive: true });
  writeFileSync(join(root, 'reports/live-smoke.json'), JSON.stringify(evidence, null, 2) + '\n');
  process.exitCode = evidence.targets.some((target) => target.status === 'failed') ? 1
    : evidence.targets.some((target) => target.status === 'inconclusive') ? 2 : 0;
}

function targets() {
  if (extraUrls.length) {
    return extraUrls.map((url, i) => ({
      url,
      fixture: `custom-${i + 1}.html`,
      waitFor: 'tr.tr__product, ul.item-listing li, tr.listerTableItem'
    }));
  }
  return TARGETS;
}

if (has('--capture')) await capture();
else if (has('--smoke')) await smoke();
else {
  console.log('Usage: node tools/live_capture.mjs --capture | --smoke [--channel=chrome|msedge] [--browser-path=...] [--headed] [--url=...]');
  process.exit(1);
}
