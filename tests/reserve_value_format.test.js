import test from 'node:test';
import assert from 'node:assert/strict';
import { formatReserveValuePerMerit } from '../src/public/js/features/treasury/index.js';

test('formatReserveValuePerMerit uses $X.XXXX×10^n (4 dp coefficient)', () => {
  assert.equal(formatReserveValuePerMerit(0), '$0.0000×10^0 / MERIT');
  assert.equal(formatReserveValuePerMerit(0.00162), '$1.6200×10^-3 / MERIT');
  assert.equal(formatReserveValuePerMerit(0.0016), '$1.6000×10^-3 / MERIT');
  assert.equal(formatReserveValuePerMerit(0.05), '$5.0000×10^-2 / MERIT');
  assert.equal(formatReserveValuePerMerit(1.5), '$1.5000×10^0 / MERIT');
  assert.equal(formatReserveValuePerMerit(undefined), '$0.0000×10^0 / MERIT');
  assert.equal(formatReserveValuePerMerit(null), '$0.0000×10^0 / MERIT');
});
