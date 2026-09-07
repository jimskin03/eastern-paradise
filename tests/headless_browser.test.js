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
  await page.setViewport({ width: 1280, height: 720 });
  page.on('dialog', async d => await d.dismiss());

  // 1. Visit Portal & Verify Desktop 16:9 Aspect Ratio
  await page.goto('http://localhost:3000', { waitUntil: 'domcontentloaded' });
  const title = await page.title();
  assert.match(title, /Eastern Paradise/);
  const desktopContainerStyle = await page.$eval('#mapContainer', el => window.getComputedStyle(el).aspectRatio);
  assert.match(desktopContainerStyle, /16\s*\/\s*9|1\.77/);

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

  // Verify canvas container aspect-ratio on mobile (6 / 19 or 19 / 6)
  const containerStyle = await mobilePage.$eval('#mapContainer', el => window.getComputedStyle(el).aspectRatio);
  assert.match(containerStyle, /6\s*\/\s*19|19\s*\/\s*6/);

  await mobilePage.close();

  // 10. Guest In-Game Puzzle Modal Verification & Rejection Test
  const guestPage = await browser.newPage();
  await guestPage.goto('http://localhost:3000', { waitUntil: 'domcontentloaded' });
  await guestPage.evaluate(() => {
    localStorage.clear();
  });

  // Enter as guest
  await guestPage.evaluate(async () => {
    await uiGuestLogin();
  });
  await guestPage.waitForFunction(
    () => window.currentAgent && window.currentAgent.is_guest === 1,
    { timeout: 8000 }
  );

  // Open wood trial obelisk modal
  await guestPage.evaluate(() => {
    openPuzzleModal('trial_obelisk_wood', 'solve');
  });
  await guestPage.waitForSelector('#modalPuzzlePrompt', { timeout: 5000 });

  // Try submitting bogus answer "I do not know now"
  await guestPage.type('#modalPuzzleAnswer', 'I do not know now');
  await guestPage.click('#btnSubmitModalPuzzle');

  // Must reject and show crimson warning
  await guestPage.waitForFunction(
    () => {
      const fb = document.getElementById('modalPuzzleFeedback');
      return fb && (fb.textContent.includes('Incorrect') || fb.textContent.includes('unyielding') || fb.textContent.includes('Too far'));
    },
    { timeout: 5000 }
  );

  // Character approaches obelisk
  await guestPage.evaluate(async () => {
    await approachModalObelisk();
  });
  await new Promise(r => setTimeout(r, 600));

  // Try bogus answer again while in range
  await guestPage.$eval('#modalPuzzleAnswer', el => el.value = 'I do not know now');
  await guestPage.click('#btnSubmitModalPuzzle');
  await guestPage.waitForFunction(
    () => {
      const fb = document.getElementById('modalPuzzleFeedback');
      return fb && (fb.textContent.includes('Incorrect') || fb.textContent.includes('unyielding') || fb.textContent.includes('deeper contemplation'));
    },
    { timeout: 5000 }
  );

  // Verify Chapter 2 is NOT completed
  const ch2Completed = await guestPage.evaluate(() => {
    return Boolean(window.QuestManager?.state?.completedChapters?.['ch2_trial']);
  });
  assert.equal(ch2Completed, false, 'Chapter 2 must not complete on wrong answer');

  await guestPage.close();
});
