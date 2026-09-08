import test from 'node:test';
import assert from 'node:assert/strict';
import { getBrowserPath, resolveBrowserPath } from './helpers/browser-discovery.js';

test('browser discovery honors configured paths before platform candidates', () => {
  const existing = new Set([
    '/custom/puppeteer',
    '/custom/chrome',
    '/usr/bin/chromium',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
  ]);
  const exists = candidate => existing.has(candidate);

  assert.equal(
    getBrowserPath({
      env: { PUPPETEER_EXECUTABLE_PATH: '/custom/puppeteer', CHROME_PATH: '/custom/chrome' },
      exists
    }),
    '/custom/puppeteer'
  );
  assert.equal(
    getBrowserPath({ env: { CHROME_PATH: '/custom/chrome' }, exists }),
    '/custom/chrome'
  );
  assert.equal(getBrowserPath({ env: {}, exists }), '/usr/bin/chromium');
  assert.equal(
    getBrowserPath({
      env: {},
      exists: candidate => candidate === '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
    }),
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
  );
  assert.equal(
    getBrowserPath({
      env: {},
      exists: candidate => candidate === 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
    }),
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
  );
});

test('missing browsers skip locally but fail when CI=true', () => {
  const unavailable = () => false;

  assert.equal(resolveBrowserPath({ env: {}, exists: unavailable }), null);
  assert.throws(
    () => resolveBrowserPath({ env: { CI: 'true' }, exists: unavailable }),
    /requires Chrome or Chromium when CI=true/
  );
});
