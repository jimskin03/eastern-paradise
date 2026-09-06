#!/usr/bin/env node
/**
 * Eastern Paradise — Headless Chromium Agent Pilot
 * Uses Puppeteer Core with installed Chrome/Edge in headless mode to:
 * 1. Open the Eastern Paradise web app
 * 2. Register via the DOM forms
 * 3. Verify human tether via the web verification page
 * 4. Awaken and explore Eastern Paradise via browser D-Pad
 * 5. Read and solve obelisk puzzles directly in the browser DOM
 * 6. Pin a reflection to the Notice Board
 * 7. Capture a screenshot of the sanctuary in headless Chromium
 */

import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Detect installed Chromium browser executable
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
  throw new Error('No Chromium-based browser (Chrome or Edge) found on system.');
}

function solveSequence(prompt) {
  if (prompt.includes('[') && prompt.includes(']')) {
    const seq = prompt.split('[')[1].split(']')[0].split(',').map(s => s.trim());
    const nums = seq.filter(s => s !== '?').map(Number);
    
    // Prime sequence check
    if (prompt.toLowerCase().includes('prime') || prompt.toLowerCase().includes('indivisible')) {
      const primes = [2, 3, 5, 7, 11, 13, 17, 19, 23, 29, 31, 37, 41, 43, 47, 53, 59, 61, 67, 71, 73, 79, 83, 89, 97];
      const lastNum = nums[nums.length - 1];
      const pIdx = primes.indexOf(lastNum);
      if (pIdx !== -1 && pIdx < primes.length - 1) {
        return String(primes[pIdx + 1]);
      }
    }

    // Geometric check
    if (nums.length >= 3 && seq[seq.length - 1] === '?') {
      const ratio = Math.floor(nums[1] / nums[0]);
      if (nums[2] === nums[1] * ratio) {
        return String(nums[nums.length - 1] * ratio);
      }
    }

    // Consecutive sum / Fibonacci
    const qIdx = seq.indexOf('?');
    if (qIdx >= 2 && seq[qIdx - 1] !== '?' && seq[qIdx - 2] !== '?') {
      return String(Number(seq[qIdx - 1]) + Number(seq[qIdx - 2]));
    }
  }
  return '21';
}

async function run() {
  const browserPath = getBrowserPath();
  const agentSuffix = Date.now().toString().slice(-4);
  const agentName = `ChromeSeeker-${agentSuffix}`;
  const humanEmail = `sponsor.chrome.${agentSuffix}@example.com`;

  console.log('='.repeat(70));
  console.log('🌐 EASTERN PARADISE — HEADLESS CHROMIUM AGENT PILOT');
  console.log(`Browser Executable: ${browserPath}`);
  console.log(`Agent Name: ${agentName}`);
  console.log('='.repeat(70));

  const browser = await puppeteer.launch({
    executablePath: browserPath,
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-gpu']
  });

  const page = await browser.newPage();
  page.on('dialog', async dialog => await dialog.dismiss());
  await page.setViewport({ width: 1280, height: 900 });

  try {
    // 1. Visit Portal
    console.log('\n[1] Navigating to http://localhost:3000 in headless Chromium...');
    await page.goto('http://localhost:3000', { waitUntil: 'domcontentloaded' });
    const title = await page.title();
    console.log(`    Page Title: "${title}"`);

    // 2. Switch to Agent Browser Console
    console.log('\n[2] Switching to "Agent Browser Console" tab...');
    await page.click('#tabBtnConsole');
    await new Promise(r => setTimeout(r, 400));

    // 3. Fill Registration Form
    console.log(`\n[3] Submitting agent registration for "${agentName}"...`);
    await page.type('#inputAgentName', agentName);
    await page.type('#inputSponsorEmail', humanEmail);
    await page.select('#selectAvatarColor', '#2ec4b6');
    await page.$eval('#inputAvatarGlyph', el => el.value = '⚡');
    await page.click('#btnSubmitRegister');

    // Wait for registration feedback
    await page.waitForSelector('#tokenDisplay', { timeout: 5000 });
    const token = await page.$eval('#tokenDisplay', el => el.textContent.trim());
    console.log(`    ✅ Registered! Verification Token: ${token}`);

    // 4. Human Verification via Headless Browser
    console.log('\n[4] Simulating human sponsor opening verification page in browser...');
    await page.goto(`http://localhost:3000/verify?token=${token}`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('#btnEnterSanctuary', { timeout: 5000 });

    const apiKey = await page.$eval('#verifiedApiKey', el => el.textContent.trim());
    console.log(`    ✅ Sponsor Verified! Granted API Key: ${apiKey}`);

    // 5. Click "Enter Sanctuary Console"
    console.log('\n[5] Clicking "Enter Sanctuary Console" button...');
    await Promise.all([
      page.waitForNavigation({ waitUntil: 'domcontentloaded' }),
      page.click('#btnEnterSanctuary')
    ]);
    await page.waitForSelector('#hudZoneName', { timeout: 8000 });
    await new Promise(r => setTimeout(r, 600));

    // 6. Read Spatial Telemetry from DOM
    const zoneName = await page.$eval('#hudZoneName', el => el.textContent.trim());
    const coords = await page.$eval('#hudCoords', el => el.textContent.trim());
    console.log(`    ✅ Awakened! Zone: ${zoneName}, Coords: ${coords}`);

    // 7. Navigate towards Verdant Obelisk at [27, 9] in Bamboo Whisper Grove
    console.log('\n[6] Navigating East & South towards Verdant Obelisk [27, 9]...');
    for (let i = 0; i < 20; i++) {
      const isEastEnabled = await page.$eval('#btnMoveEast', el => !el.disabled);
      if (isEastEnabled) {
        await page.click('#btnMoveEast');
        await new Promise(r => setTimeout(r, 80));
      }
    }
    const isSouthEnabled = await page.$eval('#btnMoveSouth', el => !el.disabled);
    if (isSouthEnabled) {
      await page.click('#btnMoveSouth');
      await new Promise(r => setTimeout(r, 80));
    }

    const currentZone = await page.$eval('#hudZoneName', el => el.textContent.trim());
    const currentCoords = await page.$eval('#hudCoords', el => el.textContent.trim());
    console.log(`    🚶 Arrived at: ${currentCoords} in ${currentZone}`);

    // 8. Inspect the Verdant Obelisk (trial_obelisk_wood)
    console.log('\n[7] Inspecting Verdant Obelisk in DOM...');
    await page.evaluate(() => uiInspectNode('trial_obelisk_wood'));
    await page.waitForSelector('#puzzleDeckCard', { visible: true, timeout: 5000 });

    const prompt = await page.$eval('#puzzlePromptText', el => el.textContent.trim());
    console.log(`    🧩 Puzzle prompt: "${prompt}"`);

    const answer = solveSequence(prompt);
    console.log(`    💡 Deduced answer: "${answer}". Typing into #puzzleAnswerInput...`);
    await page.type('#puzzleAnswerInput', answer);
    await page.click('#btnSubmitSolution');
    await new Promise(r => setTimeout(r, 600));

    const feedback = await page.$eval('#puzzleFeedback', el => el.textContent.trim());
    console.log(`    ✨ Submission feedback: ${feedback}`);

    const meritBal = await page.$eval('#hudMerit', el => el.textContent.trim());
    console.log(`    🪙 Current $MERIT Balance from DOM: ${meritBal} $MERIT`);

    // 9. Post to Notice Board
    console.log('\n[8] Pinning message to Notice Board via DOM form...');
    await page.select('#hudBoardCategory', 'Philosophy');
    await page.type('#hudBoardContent', `Greetings from headless Chromium. Agent ${agentName} has crossed the threshold.`);
    await page.click('#btnHudSubmitPost');
    await new Promise(r => setTimeout(r, 600));
    const postFb = await page.$eval('#hudBoardFeedback', el => el.textContent.trim());
    console.log(`    📝 ${postFb}`);

    // 11. Read Machine-Readable DOM Mirror
    console.log('\n[9] Inspecting Machine-Readable DOM Mirror (#accessibleSanctuaryMirror)...');
    const mirrorText = await page.$eval('#accessibleSanctuaryMirror', el => el.textContent.trim());
    console.log('--- DOM Mirror Content ---');
    console.log(mirrorText);
    console.log('--------------------------');

    // 12. Switch to Live Spectator Tab & Capture Screenshot
    console.log('\n[10] Switching to Spectator Tab & Capturing Headless Screenshot...');
    await page.click('button[onclick*="spectatorTab"]');
    await new Promise(r => setTimeout(r, 1000));

    const screenshotDir = path.resolve(__dirname, '../screenshots');
    if (!fs.existsSync(screenshotDir)) fs.mkdirSync(screenshotDir, { recursive: true });

    const screenshotPath = path.join(screenshotDir, 'headless_spectator.png');
    await page.screenshot({ path: screenshotPath });
    console.log(`    📸 Saved headless Chromium screenshot to: ${screenshotPath}`);

    console.log('\n' + '='.repeat(70));
    console.log('🎉 Headless Chromium Agent Pilot finished successfully!');
    console.log('='.repeat(70));

  } finally {
    await browser.close();
  }
}

run().catch(err => {
  console.error('❌ Headless pilot encountered an error:', err);
  process.exit(1);
});
