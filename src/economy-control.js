import crypto from 'node:crypto';
import { db } from './db.js';

export const ROLES = Object.freeze(['player', 'treasury_viewer', 'treasury_operator', 'admin']);

export const CAPABILITIES = Object.freeze({
  spend: Object.freeze(['player', 'admin']),
  transfer: Object.freeze(['player', 'admin']),
  wallet: Object.freeze(['player', 'treasury_viewer', 'treasury_operator', 'admin']),
  mint: Object.freeze(['treasury_operator', 'admin']),
  burn: Object.freeze(['treasury_operator', 'admin']),
  land: Object.freeze(['player', 'admin']),
  reconciliation: Object.freeze(['treasury_operator', 'admin'])
});

const ACTION_LIMITS = Object.freeze({
  spend: { windowMs: 60_000, max: 10 },
  transfer: { windowMs: 60_000, max: 10 },
  wallet: { windowMs: 60_000, max: 30 },
  mint: { windowMs: 60_000, max: 5 },
  burn: { windowMs: 60_000, max: 5 },
  land: { windowMs: 60_000, max: 5 },
  reconciliation: { windowMs: 60_000, max: 5 }
});

const actionBuckets = new Map();

function parseIdList(value) {
  return String(value || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

export function privacyHash(value) {
  return crypto.createHash('sha256').update(String(value || '')).digest('hex').slice(0, 16);
}

export function rateLimitSubject(accountId) {
  return `acct_${privacyHash(accountId)}`;
}

export function resolveRoles(account, env = process.env) {
  if (!account?.id) return [];
  const roles = new Set(['player']);
  const id = account.id;
  const name = account.name;
  if (parseIdList(env.TREASURY_VIEWER_AGENT_IDS).some((item) => item === id || item === name)) {
    roles.add('treasury_viewer');
  }
  if (parseIdList(env.TREASURY_OPERATOR_AGENT_IDS).some((item) => item === id || item === name)) {
    roles.add('treasury_operator');
  }
  if (parseIdList(env.TREASURY_ADMIN_AGENT_IDS).some((item) => item === id || item === name)) {
    roles.add('admin');
  }
  return [...roles];
}

export function hasCapability(roles, capability) {
  const allowed = CAPABILITIES[capability];
  if (!allowed) return false;
  return (roles || []).some((role) => allowed.includes(role));
}

export function checkActionRateLimit(accountId, action, now = Date.now()) {
  const spec = ACTION_LIMITS[action] || ACTION_LIMITS.wallet;
  const key = `${rateLimitSubject(accountId)}:${action}`;
  let timestamps = actionBuckets.get(key) || [];
  timestamps = timestamps.filter((ts) => now - ts < spec.windowMs);
  if (timestamps.length >= spec.max) {
    actionBuckets.set(key, timestamps);
    const retryAfterSec = Math.max(1, Math.ceil((timestamps[0] + spec.windowMs - now) / 1000));
    return { limited: true, retryAfter: retryAfterSec };
  }
  timestamps.push(now);
  actionBuckets.set(key, timestamps);
  return { limited: false, retryAfter: 0 };
}

export function resetActionRateLimits() {
  actionBuckets.clear();
}

export function recordAudit({
  actorId,
  action,
  route,
  amount = null,
  result,
  transactionId = null,
  requestMeta = {}
}) {
  const id = 'aud_' + crypto.randomBytes(8).toString('hex');
  const actorHash = privacyHash(actorId);
  const safeMeta = {
    method: requestMeta.method || null,
    route,
    actor_hash: actorHash,
    ip_hash: requestMeta.ip ? privacyHash(requestMeta.ip) : null
  };
  db.prepare(`
    INSERT INTO economy_audit (id, actor_id, actor_hash, action, route, amount, result, transaction_id, request_meta, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    actorId || 'anonymous',
    actorHash,
    action,
    route,
    amount,
    result,
    transactionId,
    JSON.stringify(safeMeta),
    Date.now()
  );
  return id;
}

export function readIdempotency(actorId, route, key) {
  if (!key) return null;
  return db.prepare(`
    SELECT request_hash, status_code, response_json
    FROM economy_idempotency
    WHERE actor_id = ? AND route = ? AND idempotency_key = ?
  `).get(actorId, route, key) || null;
}

export function storeIdempotency(actorId, route, key, requestHashValue, statusCode, response) {
  if (!key) return;
  db.prepare(`
    INSERT OR IGNORE INTO economy_idempotency
      (actor_id, route, idempotency_key, request_hash, status_code, response_json, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(actorId, route, key, requestHashValue, statusCode, JSON.stringify(response), Date.now());
}

export function requestHash(body) {
  return crypto.createHash('sha256').update(JSON.stringify(body || {})).digest('hex');
}
