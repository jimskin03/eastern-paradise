import test from 'node:test';
import assert from 'node:assert/strict';
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
import http from 'node:http';
import { spawn } from 'node:child_process';

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

async function isServerRunning(port = 3000) {
  return new Promise(resolve => {
    const req = http.get(`http://localhost:${port}/api/status`, res => {
      resolve(res.statusCode === 200);
    });
    req.on('error', () => resolve(false));
    req.setTimeout(400, () => {
      req.destroy();
      resolve(false);
    });
  });
}

test('6. Headless Chromium Browser Accessibility & DOM Matrix Test', async (t) => {
  const browserPath = getBrowserPath();
  if (!browserPath) {
    console.log('Skipping headless browser test: no Chrome or Edge binary found.');
    return;
  }

  let spawnedServer = null;
  const running = await isServerRunning(3000);
  if (!running) {
    spawnedServer = spawn('node', ['src/server.js'], { cwd: process.cwd() });
    await new Promise(r => setTimeout(r, 800));
  }

  const browser = await puppeteer.launch({
    executablePath: browserPath,
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-gpu']
  });

  t.after(async () => {
    await browser.close();
    if (spawnedServer) {
      spawnedServer.kill();
    }
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

  await page.waitForSelector('#tokenDisplay', { timeout: 12000 });
  const token = await page.$eval('#tokenDisplay', el => el.textContent.trim());
  assert.ok(token.startsWith('vtok_'));

  // 4. Verify via Web Portal
  await page.goto(`http://localhost:3000/verify?token=${token}`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#btnEnterSanctuary', { timeout: 12000 });
  const apiKey = await page.$eval('#verifiedApiKey', el => el.textContent.trim());
  assert.ok(apiKey.startsWith('ep_key_'));

  // 5. Enter Sanctuary Console
  await Promise.all([
    page.waitForNavigation({ waitUntil: 'domcontentloaded' }),
    page.click('#btnEnterSanctuary')
  ]);
  await page.waitForSelector('#hudZoneName', { timeout: 12000 });

  // 6. Verify Initial Telemetry
  const zone = await page.$eval('#hudZoneName', el => el.textContent.trim());
  assert.equal(zone, 'Gate of Arrival');

  // 7. Move via D-Pad
  const canMoveEast = await page.$eval('#btnMoveEast', el => !el.disabled);
  assert.equal(canMoveEast, true);
  await page.click('#btnMoveEast');
  await page.waitForFunction(
    () => document.getElementById('hudCoords')?.textContent.trim() === '[8, 8]',
    { timeout: 5000 }
  );

  const coords = await page.$eval('#hudCoords', el => el.textContent.trim());
  assert.equal(coords, '[8, 8]');

  // 8. Verify Semantic DOM Mirror
  const mirrorText = await page.$eval('#accessibleSanctuaryMirror', el => el.textContent.trim());
  const mirrorJson = JSON.parse(mirrorText);
  assert.equal(mirrorJson.agent, agentName);
  assert.deepEqual(mirrorJson.position, [8, 8]);
  assert.ok(mirrorJson.available_directions.length > 0);

  // 9. Mobile Responsive Viewport & Quest HUD Collapse Verification
  const mobilePage = await browser.newPage();
  await mobilePage.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
  await mobilePage.goto('http://localhost:3000', { waitUntil: 'domcontentloaded' });

  // Verify HUD starts collapsed on mobile viewport (width <= 768)
  const isCollapsedInitial = await mobilePage.$eval('#questHud', el => el.classList.contains('collapsed'));
  assert.equal(isCollapsedInitial, true);

  // When collapsed, body must be hidden
  const bodyDisplay = await mobilePage.$eval('#questHudBody', el => window.getComputedStyle(el).display);
  assert.equal(bodyDisplay, 'none');

  // Toggle expand
  await mobilePage.click('#btnToggleQuestHud');
  const isExpanded = await mobilePage.$eval('#questHud', el => !el.classList.contains('collapsed'));
  assert.equal(isExpanded, true);
  const bodyDisplayExpanded = await mobilePage.$eval('#questHudBody', el => window.getComputedStyle(el).display);
  assert.notEqual(bodyDisplayExpanded, 'none');

  // Toggle collapse again
  await mobilePage.click('#btnToggleQuestHud');
  const isCollapsedAgain = await mobilePage.$eval('#questHud', el => el.classList.contains('collapsed'));
  assert.equal(isCollapsedAgain, true);

  // Verify canvas container aspect-ratio on mobile (3 / 2)
  const containerStyle = await mobilePage.$eval('#mapContainer', el => window.getComputedStyle(el).aspectRatio);
  assert.match(containerStyle, /3\s*\/\s*2|1\.5/);

  await mobilePage.close();
});
