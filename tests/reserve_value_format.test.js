import test from 'node:test';
import assert from 'node:assert/strict';
import { formatReserveValuePerMerit } from '../src/public/js/features/treasury/index.js';

test('formatReserveValuePerMerit always uses exactly four decimal places', () => {
  assert.equal(formatReserveValuePerMerit(0), '$0.0000 / MERIT');
  assert.equal(formatReserveValuePerMerit(0.00162), '$0.0016 / MERIT');
  assert.equal(formatReserveValuePerMerit(0.05), '$0.0500 / MERIT');
  assert.equal(formatReserveValuePerMerit(1.5 / 3056), `$${(1.5 / 3056).toFixed(4)} / MERIT`);
  assert.equal(formatReserveValuePerMerit(undefined), '$0.0000 / MERIT');
  assert.equal(formatReserveValuePerMerit(null), '$0.0000 / MERIT');
});
