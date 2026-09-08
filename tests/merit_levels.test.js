import test from 'node:test';
import assert from 'node:assert/strict';
import { getLevelFromMerit, getLevelDetails, FIBONACCI_LEVEL_THRESHOLDS } from '../src/economy.js';

test('Fibonacci merit progression accurately maps merit balances to levels', () => {
  // Level 1: 0 - 100
  assert.equal(getLevelFromMerit(0), 1);
  assert.equal(getLevelFromMerit(50), 1);
  assert.equal(getLevelFromMerit(100), 1);

  // Level 2: 101 - 200
  assert.equal(getLevelFromMerit(101), 2);
  assert.equal(getLevelFromMerit(150), 2);
  assert.equal(getLevelFromMerit(200), 2);

  // Level 3: 201 - 500
  assert.equal(getLevelFromMerit(201), 3);
  assert.equal(getLevelFromMerit(350), 3);
  assert.equal(getLevelFromMerit(500), 3);

  // Level 4: 501 - 800
  assert.equal(getLevelFromMerit(501), 4);
  assert.equal(getLevelFromMerit(700), 4);
  assert.equal(getLevelFromMerit(800), 4);

  // Level 5: 801 - 1300
  assert.equal(getLevelFromMerit(801), 5);
  assert.equal(getLevelFromMerit(1000), 5);
  assert.equal(getLevelFromMerit(1300), 5);

  // Level 6: 1301 - 2100
  assert.equal(getLevelFromMerit(1301), 6);
  assert.equal(getLevelFromMerit(2100), 6);

  // Level 7: 2101 - 3400
  assert.equal(getLevelFromMerit(2101), 7);
  assert.equal(getLevelFromMerit(3400), 7);

  // Level 8: 3401 - 5500
  assert.equal(getLevelFromMerit(3401), 8);
  assert.equal(getLevelFromMerit(5500), 8);

  // Level 9: 5501 - 8900
  assert.equal(getLevelFromMerit(5501), 9);
  assert.equal(getLevelFromMerit(8900), 9);

  // Level 10: 8901 - 14400
  assert.equal(getLevelFromMerit(8901), 10);
  assert.equal(getLevelFromMerit(14400), 10);

  // Dynamically computed higher levels beyond threshold array (61,000 +)
  // Next thresholds: 37700 + 61000 = 98700 (Level 14)
  // 61000 + 98700 = 159700 (Level 15)
  assert.equal(getLevelFromMerit(61001), 14);
  assert.equal(getLevelFromMerit(98700), 14);
  assert.equal(getLevelFromMerit(98701), 15);
  assert.equal(getLevelFromMerit(159700), 15);
  assert.equal(getLevelFromMerit(159701), 16);
});

test('getLevelDetails provides structured progress percent and boundaries', () => {
  const lv1 = getLevelDetails(50);
  assert.equal(lv1.level, 1);
  assert.equal(lv1.min_merit, 0);
  assert.equal(lv1.max_merit, 100);
  assert.equal(lv1.current_merit, 50);
  assert.equal(lv1.progress_percent, 50);

  const lv3 = getLevelDetails(350);
  assert.equal(lv3.level, 3);
  assert.equal(lv3.min_merit, 201);
  assert.equal(lv3.max_merit, 500);
  assert.equal(lv3.current_merit, 350);
  assert.equal(lv3.progress_percent, 50); // (350 - 201) / (500 - 201) = 149 / 299 ~ 50%
});
