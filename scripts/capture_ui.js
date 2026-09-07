import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
import path from 'node:path';
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

async function main() {
  const browserPath = getBrowserPath();
  if (!browserPath) {
    console.error('No browser executable found.');
    process.exit(1);
  }

  const PORT = 3088;
  const env = { ...process.env, PORT: String(PORT) };
  const srv = spawn('node', ['src/server.js'], { env, cwd: process.cwd() });
  await new Promise(r => setTimeout(r, 1200));

  const browser = await puppeteer.launch({
    executablePath: browserPath,
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-gpu']
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 860 });

  const artifactDir = 'C:\\Users\\Greg\\.gemini\\antigravity\\brain\\28ae71cc-161d-4bae-833b-dbba4bb26a4c';

  try {
    // 1. Spectator view
    await page.goto(`http://localhost:${PORT}`, { waitUntil: 'networkidle2' });
    await new Promise(r => setTimeout(r, 1500));

    // Open inspector on resident_jun
    await page.evaluate(() => {
      if (typeof openAgentProfileInspector === 'function') {
        openAgentProfileInspector('resident_jun');
      }
    });
    await new Promise(r => setTimeout(r, 1200));

    const shotSpectator = path.join(artifactDir, 'spectator_resident_inspector.png');
    await page.screenshot({ path: shotSpectator });
    console.log('Saved:', shotSpectator);

    // 2. Journal view
    await page.click('#tabBtnJournal');
    await new Promise(r => setTimeout(r, 1200));

    const shotJournal = path.join(artifactDir, 'sanctuary_journal_tab.png');
    await page.screenshot({ path: shotJournal });
    console.log('Saved:', shotJournal);

  } finally {
    await browser.close();
    srv.kill();
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
