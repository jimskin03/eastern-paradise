import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

function read(path) {
  return fs.readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
}

test('wallet bundle is lazy-loaded rather than included in the initial HTML', () => {
  const html = read('src/public/index.html');
  const wallet = read('src/public/js/features/wallet/index.js');
  assert.ok(!html.includes('<script type="module" src="/js/vendor/metamask-solana.bundle.js"></script>'));
  assert.ok(wallet.includes("import('../../vendor/metamask-solana.bundle.js')"));
});

test('board flow creates a reusable session before posting and keeps draft semantics', () => {
  const board = read('src/public/js/features/board/index.js');
  assert.ok(board.includes("from '../../state/session-store.js'"));
  assert.ok(board.includes("apiFetch('/api/auth/guest'"));
  assert.ok(board.includes('Your draft is preserved'));
  assert.ok(!board.includes('body.as_guest'));
});

test('puzzle celebration reads authoritative reward values from the server', () => {
  const app = read('src/public/js/app.js');
  assert.ok(app.includes('data.reward?.merit_earned'));
  assert.ok(app.includes('data.reward?.karma_added'));
  assert.ok(!app.includes('Trial Solved! +10 $MERIT, +25 Karma'));
});

test('static serving includes cache validation headers', () => {
  const staticFiles = read('src/http/helpers/static-files.js');
  assert.ok(staticFiles.includes('Cache-Control'));
  assert.ok(staticFiles.includes('ETag'));
  assert.ok(staticFiles.includes("if-none-match"));
});
