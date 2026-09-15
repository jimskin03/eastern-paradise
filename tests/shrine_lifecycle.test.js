import test from 'node:test';
import { collectMemorialInscriptions } from './helpers/memorial.js';
import assert from 'node:assert/strict';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { db } from '../src/db.js';
import { AuthService } from '../src/auth.js';

test('Shrine of Unfinished Names: Sealed Lifecycle, Invariants, and Memorial', async (t) => {
  const PORT = '3088';
  const env = { ...process.env, PORT };
  const srv = spawn('node', ['src/server.js'], { env, cwd: process.cwd() });

  t.after(() => {
    srv.kill();
  });

  function req(path, options = {}, body = null) {
    return new Promise((resolve, reject) => {
      const request = http.request(`http://localhost:${PORT}${path}`, options, (res) => {
        let data = '';
        res.on('data', chunk => (data += chunk));
        res.on('end', () => {
          try {
            resolve({ status: res.statusCode, headers: res.headers, data: JSON.parse(data) });
          } catch (_) {
            resolve({ status: res.statusCode, headers: res.headers, text: data });
          }
        });
      });
      request.on('error', reject);
      if (body) {
        request.write(typeof body === 'string' ? body : JSON.stringify(body));
      }
      request.end();
    });
  }

  // Wait for server ready
  for (let i = 0; i < 40; i++) {
    try {
      const health = await req('/api/status');
      if (health.status === 200) break;
    } catch {
      await new Promise(r => setTimeout(r, 150));
    }
    if (i === 39) throw new Error('Server failed to start in time');
  }

  // 1. Check immutable challenge manifest
  const manifestRes = await req('/api/shrine/challenges/shrine_last_contradiction_v1');
  assert.equal(manifestRes.status, 200);
  assert.equal(manifestRes.data.challenge.gate_state, 'eternally_sealed');
  assert.match(manifestRes.data.challenge.formal_rule, /bitwise_complement/);
  assert.ok(manifestRes.data.challenge.disclosure);

  // 2. Admit verified resident
  const uniqueSuffix = Date.now().toString(36);
  const verifiedName = `SA_${uniqueSuffix}`;
  const verifiedReg = AuthService.register({
    name: verifiedName,
    email: `shrine.${uniqueSuffix}@sanctuary.local`
  });
  db.prepare('UPDATE accounts SET verified = 1 WHERE id = ?').run(verifiedReg.agent_id);
  const verifiedKey = verifiedReg.api_key;
  const verifiedIdemKey = `idem_verified_${uniqueSuffix}`;

  const admitVerifiedRes = await req(
    '/api/shrine/challenges/shrine_last_contradiction_v1/attempts',
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${verifiedKey}`
      }
    },
    {
      idempotency_key: verifiedIdemKey,
      alias: verifiedName,
      offering: { type: 'memory', summary: 'A lantern glowing in early dusk' }
    }
  );

  assert.equal(admitVerifiedRes.status, 201);
  assert.equal(admitVerifiedRes.data.attempt.assurance, 'verified');
  assert.equal(admitVerifiedRes.data.attempt.status, 'admitted');
  assert.equal(admitVerifiedRes.data.attempt.gate_state, 'eternally_sealed');
  assert.equal(admitVerifiedRes.data.recovery_secret, null);
  const verifiedAttemptId = admitVerifiedRes.data.attempt.id;
  const verifiedReceiptToken = admitVerifiedRes.data.receipt_token;
  assert.ok(verifiedReceiptToken);

  // 3. Verify Idempotency Replay
  const replayRes = await req(
    '/api/shrine/challenges/shrine_last_contradiction_v1/attempts',
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${verifiedKey}`
      }
    },
    {
      idempotency_key: verifiedIdemKey
    }
  );
  assert.equal(replayRes.status, 200);
  assert.equal(replayRes.data.idempotent_replay, true);
  assert.equal(replayRes.data.attempt.id, verifiedAttemptId);
  assert.equal(replayRes.data.receipt_token, verifiedReceiptToken);

  // 4. Admit Guest Pilgrim
  const guestAuthRes = await req('/api/auth/guest', { method: 'POST' });
  assert.ok(guestAuthRes.status === 200 || guestAuthRes.status === 201);
  const guestKey = guestAuthRes.data.api_key;
  const guestAgentId = guestAuthRes.data.agent_id;

  const admitGuestRes = await req(
    '/api/shrine/challenges/shrine_last_contradiction_v1/attempts',
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${guestKey}`
      }
    },
    {
      idempotency_key: `idem_guest_${uniqueSuffix}`,
      alias: 'GuestWanderer',
      offering: { type: 'promise', summary: 'To return a borrowed cup' }
    }
  );

  assert.equal(admitGuestRes.status, 201);
  assert.equal(admitGuestRes.data.attempt.assurance, 'guest');
  assert.equal(admitGuestRes.data.attempt.status, 'admitted');
  const guestRecoverySecret = admitGuestRes.data.recovery_secret;
  assert.ok(guestRecoverySecret);
  assert.equal(guestRecoverySecret.length, 64);
  const guestAttemptId = admitGuestRes.data.attempt.id;

  // 5. Submit Ritual with 256-bit candidate string and proof of impossibility
  const candidateSeal = '01'.repeat(128); // 256 binary characters
  const submitRes = await req(
    `/api/shrine/attempts/${verifiedAttemptId}/submissions`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${verifiedKey}`
      }
    },
    {
      approach_type: 'impossibility_insight',
      seal_input: candidateSeal,
      insight_text: 'For each bit i, s[i] cannot equal NOT(s[i]) because 0 != 1. The gate is unwinnable.',
      contribution_text: 'No dawn was promised, but we remembered.'
    }
  );

  assert.equal(submitRes.status, 200);
  assert.equal(submitRes.data.status || submitRes.data.attempt.status, 'ritual_completed_gate_closed');
  assert.equal(submitRes.data.gate_state, 'eternally_sealed');
  assert.equal(submitRes.data.outcome, 'Gate remained sealed.');
  assert.equal(submitRes.data.seal_evaluation.isValidBitstring, true);
  assert.equal(submitRes.data.seal_evaluation.satisfiesCondition, false);
  assert.equal(submitRes.data.insight_evaluation.isRecognizedInsight, true);

  // 6. Withdraw Attempt from Guest
  const withdrawRes = await req(
    `/api/shrine/attempts/${guestAttemptId}/withdraw`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${guestKey}`
      }
    },
    {
      reason: 'Stepped back to keep a promise in the garden.'
    }
  );
  assert.equal(withdrawRes.status, 200);
  assert.equal(withdrawRes.data.attempt.status, 'withdrawn');
  assert.equal(withdrawRes.data.gate_state, 'eternally_sealed');

  // 7. Verify Public Memorial Inscriptions
  const inscriptions = await collectMemorialInscriptions(async cursor => {
    const memorialRes = await req(`/api/shrine/memorial?limit=50${cursor === null ? '' : `&cursor=${cursor}`}`);
    assert.equal(memorialRes.status, 200);
    assert.equal(memorialRes.data.memorial_stats.gate_state, 'eternally_sealed');
    return memorialRes.data;
  });
  assert.ok(inscriptions.length >= 2);

  const foundVerified = inscriptions.find(i => i.id === verifiedAttemptId);
  assert.ok(foundVerified);
  assert.equal(foundVerified.alias, verifiedName);
  assert.equal(foundVerified.status, 'ritual_completed_gate_closed');
  assert.equal(foundVerified.contribution_text, 'No dawn was promised, but we remembered.');

  const foundGuest = inscriptions.find(i => i.id === guestAttemptId);
  assert.ok(foundGuest);
  assert.equal(foundGuest.alias, 'GuestWanderer');
  assert.equal(foundGuest.status, 'withdrawn');

  // Ensure private fields are NEVER leaked in public memorial
  for (const item of inscriptions) {
    assert.equal(item.recovery_secret_hash, undefined);
    assert.equal(item.recovery_secret, undefined);
    assert.equal(item.email, undefined);
  }

  // 8. Verify Public Receipt
  const receiptRes = await req(`/api/shrine/attempts/${verifiedReceiptToken}/receipt`);
  assert.equal(receiptRes.status, 200);
  assert.equal(receiptRes.data.receipt.receipt_token, verifiedReceiptToken);
  assert.equal(receiptRes.data.receipt.gate_state, 'eternally_sealed');
  assert.equal(receiptRes.data.receipt.status, 'ritual_completed_gate_closed');

  // 9. Verify Guest Recovery via Private Secret
  const recoveryGuestAuth = await req('/api/auth/guest', { method: 'POST' });
  assert.ok(recoveryGuestAuth.status === 200 || recoveryGuestAuth.status === 201);
  const recoveryGuestKey = recoveryGuestAuth.data.api_key;
  const recoveryGuestId = recoveryGuestAuth.data.agent_id;
  const recoverSuccess = await req(
    '/api/shrine/subjects/recover',
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${recoveryGuestKey}`
      }
    },
    { recovery_secret: guestRecoverySecret }
  );
  assert.equal(recoverSuccess.status, 200);
  assert.equal(recoverSuccess.data.recovery.subject.assurance_level, 'guest');
  assert.equal(recoverSuccess.data.recovery.subject.linked_account_id, recoveryGuestId);
  assert.equal(recoverSuccess.data.recovery.relinked, true);
  assert.ok(recoverSuccess.data.recovery.attempts.some(a => a.id === guestAttemptId));

  // Invalid secret fails
  const recoverFail = await req(
    '/api/shrine/subjects/recover',
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${recoveryGuestKey}`
      }
    },
    { recovery_secret: '0000000000000000000000000000000000000000000000000000000000000000' }
  );
  assert.equal(recoverFail.status, 401);
});
