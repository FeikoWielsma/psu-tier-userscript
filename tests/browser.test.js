// Real Chromium tests of the built userscript. All page requests are intercepted;
// site availability, trackers and saved-page scripts cannot affect the verdict.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { chromium } = require('playwright');
const { root } = require('./helpers.js');
const script = fs.readFileSync(path.join(root, 'psutier.user.js'), 'utf8');
let browser;
before(async () => { browser = await chromium.launch({ headless: true }); });
after(async () => { await browser?.close(); });

async function setup(t, site, fixture, viewport = { width: 1280, height: 900 }) {
    const context = await browser.newContext({ viewport });
    t.after(() => context.close());
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    t.after(() => assert.deepEqual(errors, [], 'No userscript runtime errors'));
    const url = site === 'pcpp' ? 'https://pcpartpicker.com/products/power-supply/' : 'https://tweakers.net/voedingen/vergelijken/';
    let html = fs.readFileSync(path.join(__dirname, 'fixtures', fixture), 'utf8')
        .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '');
    // Saved row fixtures omit the sidebar; supply the adapter's documented
    // host anchor to exercise docking as well as the floating fallback.
    if (site === 'pcpp') html += '<aside><div class="group--filter" id="filterdiv_fixture"></div></aside>';
    await context.route('**/*', (route) => route.request().isNavigationRequest()
        ? route.fulfill({ contentType: 'text/html', body: html }) : route.abort());
    await page.goto(url);
    await page.addScriptTag({ content: script });
    await page.waitForSelector('.psu-tier-badge');
    return page;
}

test('Tweakers: exact identity, honest similarity wording, keyboard popup and uncertainty', async (t) => {
    const page = await setup(t, 'tweakers', 'tweakers-real.html');
    const row = page.locator('li').filter({ has: page.locator('a.editionName', { hasText: /^Corsair RM850x \(2024\)$/ }) });
    const badge = row.locator('.psu-tier-badge');
    assert.equal(await badge.textContent(), 'Tier A+');
    assert.equal(await badge.evaluate((el) => el.tagName), 'BUTTON');
    await badge.focus();
    await page.keyboard.press('Enter');
    const popup = page.locator('#psu-tier-popup');
    await popup.waitFor();
    assert.match(await popup.textContent(), /RM-x 2024/);
    assert.match(await popup.textContent(), /not a probability/);
    assert.doesNotMatch(await popup.textContent(), /\d+%/);
    const support = popup.getByRole('link', { name: 'Support development on Ko-fi' });
    assert.equal(await support.getAttribute('href'), 'https://ko-fi.com/feiko');
    assert.equal(await support.getAttribute('target'), '_blank');
    assert.match(await support.getAttribute('rel'), /noopener/);
    await popup.getByRole('button', { name: 'Close' }).click();
    assert.equal(await popup.count(), 0);
    const msi = page.locator('li').filter({ has: page.locator('a.editionName', { hasText: /^MSI MAG A850GL PCIE5 Zwart$/ }) });
    assert.match(await msi.locator('.psu-tier-badge').textContent(), /\?$/);
});

test('Tweakers: reused rows reject unknown generations and recover correctly', async (t) => {
    const page = await setup(t, 'tweakers', 'tweakers-real.html');
    const name = page.locator('a.editionName').first();
    const row = name.locator('xpath=ancestor::li[1]');
    await name.evaluate((el) => { el.textContent = 'MSI MAG A850GL PCIE5 III'; });
    await page.waitForFunction(() => document.querySelector('a.editionName').closest('li').dataset.psuTier === 'UNRATED');
    assert.equal(await row.locator('.psu-tier-badge').count(), 0);
    await page.locator('#psu-filter-un').check();
    assert.equal(await row.isVisible(), false);
    await name.evaluate((el) => { el.textContent = 'MSI MAG A850GL PCIE5 II'; });
    await page.waitForFunction(() => document.querySelector('a.editionName').closest('li').dataset.psuTier === 'B');
    assert.equal(await row.isVisible(), true);
    assert.equal(await row.locator('.psu-tier-badge').count(), 1);
    assert.equal(await row.locator('.psu-tier-badge').textContent(), 'Tier B* (LC)');
    await page.locator('#psu-filter-lc').check();
    assert.equal(await row.isVisible(), false);
    await page.locator('#psu-filter-lc').uncheck();
    assert.equal(await row.isVisible(), true);
});

test('Tweakers: inserted/replaced rows, removed badges and filter remount do not duplicate UI', async (t) => {
    const page = await setup(t, 'tweakers', 'tweakers-real.html');
    const initial = await page.locator('ul.item-listing > li').count();
    await page.evaluate(() => {
        const row = /** @type {HTMLElement} */ (document.querySelector('ul.item-listing > li').cloneNode(true));
        row.querySelectorAll('.psu-tier-badge').forEach((el) => el.remove());
        document.querySelector('ul.item-listing').appendChild(row);
        document.querySelector('#psu-filter-ui, #psu-filter-group').remove();
    });
    await page.waitForFunction(() => document.querySelector('ul.item-listing > li:last-child .psu-tier-badge'));
    assert.equal(await page.locator('ul.item-listing > li').count(), initial + 1);
    await page.waitForSelector('#psu-filter-ui, #psu-filter-group');
    const last = page.locator('ul.item-listing > li').last();
    await last.locator('.psu-tier-badge').evaluate((el) => el.remove());
    await last.locator('.psu-tier-badge').waitFor();
    await page.evaluate(() => {
        const row = document.querySelector('ul.item-listing > li:last-child');
        row.replaceWith(row.cloneNode(true));
    });
    await page.waitForFunction(() => [...document.querySelectorAll('ul.item-listing > li')].every((el) => el.querySelectorAll('.psu-tier-badge').length <= 1));
    await last.locator('.psu-tier-badge').click();
    await page.getByRole('dialog', { name: 'PSU tier details' }).waitFor();
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('#psu-tier-popup').count(), 0);
    assert.equal(await page.locator('#psu-filter-ui, #psu-filter-group').count(), 1);
});

test('PCPartPicker: exact extraction stays stable after badge insertion and tier filters work', async (t) => {
    const page = await setup(t, 'pcpp', 'pcpp/pcpp-nzxt.html');
    const row = page.locator('tr.tr__product').filter({ hasText: 'NZXT C750' }).filter({ hasText: 'Bronze' });
    const badge = row.locator('.psu-tier-badge').first();
    assert.match(await badge.textContent(), /^Tier C/);
    await badge.click();
    assert.match(await page.locator('#psu-tier-popup').textContent(), /C Series Bronze/);
    await page.locator('#psu-popup-close').click();
    await page.locator('#psu-filter-tier').selectOption('A+');
    assert.equal(await row.first().isVisible(), false);
    await page.locator('#psu-filter-tier').selectOption('ANY');
    assert.equal(await row.first().isVisible(), true);
    assert.equal(await row.first().locator('.psu-tier-badge').count(), 1);
    await page.locator('#psu-filter-popout').click();
    assert.equal(await page.locator('#psu-filter-ui').count(), 1);
    await page.getByTitle('Dock into the PCPartPicker filter sidebar', { exact: true }).click();
    assert.equal(await page.locator('#psu-filter-group').count(), 1);
    assert.equal(await page.locator('#psu-filter-ui').count(), 0);
});

test('narrow screen: popup and keyboard controls remain usable; panel preferences survive reload', async (t) => {
    const page = await setup(t, 'tweakers', 'tweakers-real.html', { width: 390, height: 844 });
    await page.locator('.psu-tier-badge').first().click();
    const popup = page.locator('#psu-tier-popup');
    const box = await popup.boundingBox();
    assert.ok(box.x >= 0 && box.x + box.width <= 390, JSON.stringify(box));
    await popup.getByRole('button', { name: 'Close' }).click();
    const collapse = page.getByTitle('Collapse PSU tier filter (filters stay applied)', { exact: true });
    assert.equal(await collapse.count(), 1, 'Floating filter must expose collapse controls');
    {
        await collapse.click();
        assert.equal(await page.locator('#psu-filter-tier').isVisible(), false);
        await page.reload();
        await page.addScriptTag({ content: script });
        assert.equal(await page.locator('#psu-filter-tier').isVisible(), false);
        await page.getByTitle('Show PSU tier filter (filters stay applied)', { exact: true }).click();
        assert.equal(await page.locator('#psu-filter-tier').isVisible(), true);
    }
});

test('packaged extension injects its content script through the actual manifest', async (t) => {
    const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'psu-extension-'));
    const extension = path.join(root, 'dist-extension');
    const context = await chromium.launchPersistentContext(profile, {
        channel: 'chromium', headless: true,
        args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`]
    });
    t.after(async () => { await context.close(); fs.rmSync(profile, { recursive: true, force: true }); });
    const html = fs.readFileSync(path.join(__dirname, 'fixtures/tweakers-real.html'), 'utf8');
    await context.route('**/*', (route) => route.request().isNavigationRequest()
        ? route.fulfill({ contentType: 'text/html', body: html }) : route.abort());
    const page = await context.newPage();
    await page.goto('https://tweakers.net/voedingen/vergelijken/');
    await page.waitForSelector('.psu-tier-badge');
    assert.ok(await page.locator('.psu-tier-badge').count() > 5);
    const row = page.locator('li').filter({ has: page.locator('a.editionName', { hasText: /^Corsair RM850x \(2024\)$/ }) });
    assert.equal(await row.locator('.psu-tier-badge').textContent(), 'Tier A+');
});
