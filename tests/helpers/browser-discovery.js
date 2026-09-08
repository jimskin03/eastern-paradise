import fs from 'node:fs';

export function getBrowserPath({ env = process.env, exists = fs.existsSync } = {}) {
  const candidates = [
    env.PUPPETEER_EXECUTABLE_PATH,
    env.CHROME_PATH,
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe'
  ];

  return candidates.find(candidate => candidate && exists(candidate)) || null;
}

export function resolveBrowserPath({ env = process.env, exists = fs.existsSync } = {}) {
  const browserPath = getBrowserPath({ env, exists });
  if (!browserPath && env.CI === 'true') {
    throw new Error('Headless browser test requires Chrome or Chromium when CI=true.');
  }
  return browserPath;
}
