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
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
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
  await page.goto(target.url, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForSelector(target.waitFor, { timeout: 30000 }).catch(() => {
    console.warn(`  ! "${target.waitFor}" never appeared on ${target.url}`);
  });
  await sleep(1500);
}

async function capture() {
  await withPage(async (page) => {
    for (const target of targets()) {
      console.log(`Capturing ${target.url}`);
      await gotoTarget(page, target);
      const html = await page.content();
      const out = join(root, 'tests', 'fixtures', target.fixture);
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

  await withPage(async (page) => {
    for (const target of targets()) {
      console.log(`\nSmoke testing ${target.url}`);
      await gotoTarget(page, target);
      await page.evaluate(userscript);
      await sleep(1500);

      const report = await page.evaluate(() => {
        const badges = [...document.querySelectorAll('.psu-tier-badge')];
        const strong = badges.filter((b) => !/\?$/.test(b.textContent)).length;
        const likely = badges.length - strong;
        return { badges: badges.length, strong, likely };
      });
      console.log(`  badges: ${report.badges} (strong ${report.strong}, likely ${report.likely})`);
      if (!report.badges) console.warn('  ! no badges - selectors may have drifted (refresh fixtures and check adapters)');
      await sleep(2000);
    }
  });
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
