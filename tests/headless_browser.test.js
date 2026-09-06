import test from 'node:test';
import assert from 'node:assert/strict';
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';

function getBrowserPath() {
  const candidates = [
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe'
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  return null;
}

test('6. Headless Chromium Browser Accessibility & DOM Matrix Test', async (t) => {
  const browserPath = getBrowserPath();
  if (!browserPath) {
    console.log('Skipping headless browser test: no Chrome or Edge binary found.');
    return;
  }

  const browser = await puppeteer.launch({
    executablePath: browserPath,
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-gpu']
  });

  t.after(async () => {
    await browser.close();
  });

  const page = await browser.newPage();
  page.on('dialog', async d => await d.dismiss());

  // 1. Visit Portal
  await page.goto('http://localhost:3000', { waitUntil: 'domcontentloaded' });
  const title = await page.title();
  assert.match(title, /Eastern Paradise/);

  // 2. Open Agent Browser Console
  await page.click('#tabBtnConsole');
  await new Promise(r => setTimeout(r, 200));

  // 3. Register via DOM
  const agentName = `ChromiumTest_${Date.now().toString().slice(-4)}`;
  await page.type('#inputAgentName', agentName);
  await page.type('#inputSponsorEmail', 'test.sponsor@example.org');
  await page.click('#btnSubmitRegister');

  await page.waitForSelector('#tokenDisplay', { timeout: 4000 });
  const token = await page.$eval('#tokenDisplay', el => el.textContent.trim());
  assert.ok(token.startsWith('vtok_'));

  // 4. Verify via Web Portal
  await page.goto(`http://localhost:3000/verify?token=${token}`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#btnEnterSanctuary', { timeout: 4000 });
  const apiKey = await page.$eval('#verifiedApiKey', el => el.textContent.trim());
  assert.ok(apiKey.startsWith('ep_key_'));

  // 5. Enter Sanctuary Console
  await Promise.all([
    page.waitForNavigation({ waitUntil: 'domcontentloaded' }),
    page.click('#btnEnterSanctuary')
  ]);
  await page.waitForSelector('#hudZoneName', { timeout: 4000 });

  // 6. Verify Initial Telemetry
  const zone = await page.$eval('#hudZoneName', el => el.textContent.trim());
  assert.equal(zone, 'Gate of Arrival');

  // 7. Move via D-Pad
  const canMoveEast = await page.$eval('#btnMoveEast', el => !el.disabled);
  assert.equal(canMoveEast, true);
  await page.click('#btnMoveEast');
  await new Promise(r => setTimeout(r, 150));

  const coords = await page.$eval('#hudCoords', el => el.textContent.trim());
  assert.equal(coords, '[8, 8]');

  // 8. Verify Semantic DOM Mirror
  const mirrorText = await page.$eval('#accessibleSanctuaryMirror', el => el.textContent.trim());
  const mirrorJson = JSON.parse(mirrorText);
  assert.equal(mirrorJson.agent, agentName);
  assert.deepEqual(mirrorJson.position, [8, 8]);
  assert.ok(mirrorJson.available_directions.length > 0);
});
