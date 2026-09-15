import test from 'node:test';
import assert from 'node:assert/strict';
import { db } from '../src/db.js';
import { AuthService } from '../src/auth.js';
import { admitAttempt } from '../src/domain/shrine/attempts.js';
import { getMemorialInscriptions, recoverGuestSubject } from '../src/domain/shrine/memorial.js';
import { wipeNonAiliciaLogs } from '../src/infrastructure/database/cloud/maintenance.js';
import { shouldRetainCloudRow } from '../src/infrastructure/database/cloud/filters.js';

test('Shrine Permanence: Inscriptions Survive Guest Session Purge & Cloud Maintenance', () => {
  // 1. Create a guest session
  const guest = AuthService.createGuest({ name: 'EphemeralPilgrim' });
  const guestId = guest.agent_id;

  // 2. Admit the guest to the sealed shrine
  const uniqueIdem = `idem_perm_${Date.now()}`;
  const admission = admitAttempt({
    actorId: guestId,
    alias: 'EphemeralPilgrim',
    isGuest: true,
    idempotencyKey: uniqueIdem,
    offering: { type: 'memory', summary: 'A fleeting glimpse of morning mist' }
  });

  assert.ok(admission.attempt.id);
  assert.equal(admission.attempt.status, 'admitted');
  const recoverySecret = admission.recovery_secret;
  assert.ok(recoverySecret);

  // 3. Purge the guest session via standard AuthService.purgeGuest
  const purgeResult = AuthService.purgeGuest(guestId);
  assert.equal(purgeResult.purged, true);

  // Verify account is purged
  const accountRow = db.prepare('SELECT * FROM accounts WHERE id = ?').get(guestId);
  assert.equal(accountRow, undefined);

  // 4. Invariant: Memorial Subject & Inscription MUST SURVIVE
  const attemptRow = db.prepare('SELECT * FROM shrine_attempts WHERE id = ?').get(admission.attempt.id);
  assert.ok(attemptRow, 'Shrine attempt must survive guest session purge');
  assert.equal(attemptRow.alias_snapshot, 'EphemeralPilgrim');
  assert.equal(attemptRow.assurance_snapshot, 'guest');

  const subjectRow = db.prepare('SELECT * FROM memorial_subjects WHERE id = ?').get(attemptRow.memorial_subject_id);
  assert.ok(subjectRow, 'Memorial subject must survive guest session purge');

  // 5. Invariant: Guest can still recover their inscription with their private secret
  const recovered = recoverGuestSubject({ recoverySecret });
  assert.ok(recovered, 'Guest must be able to recover their inscription record using the private recovery secret');
  assert.equal(recovered.subject.public_alias, 'EphemeralPilgrim');
  assert.ok(recovered.attempts.some(a => a.id === admission.attempt.id));

  // 6. Routine Maintenance: execute wipeNonAiliciaLogs
  const countBefore = db.prepare('SELECT COUNT(*) AS c FROM shrine_attempts').get().c;
  wipeNonAiliciaLogs({ db });
  const countAfter = db.prepare('SELECT COUNT(*) AS c FROM shrine_attempts').get().c;
  assert.equal(countAfter, countBefore, 'wipeNonAiliciaLogs must not delete any shrine attempts');

  // 7. Verify Inscription still present in public memorial list
  const memorial = getMemorialInscriptions({ limit: 100 });
  assert.ok(memorial.inscriptions.some(i => i.id === admission.attempt.id));

  // 8. Cloud Filter Exemption: Test that cloud filters retain shrine records even with guest flags
  assert.equal(shouldRetainCloudRow('memorial_subjects', { id: 'subj_1', linked_account_id: guestId, is_guest: 1 }), true);
  assert.equal(shouldRetainCloudRow('shrine_attempts', { id: 'att_1', agent_id: guestId }), true);
  assert.equal(shouldRetainCloudRow('shrine_challenges', { id: 'shrine_1' }), true);
  assert.equal(shouldRetainCloudRow('shrine_attempt_events', { id: 'shevt_1', agent_id: guestId }), true);

  // Contrast with normal guest rows that get excluded
  assert.equal(shouldRetainCloudRow('agent_memories', { id: 'mem_1', agent_id: guestId }), false);
  assert.equal(shouldRetainCloudRow('accounts', { id: guestId, is_guest: 1 }), false);
});
