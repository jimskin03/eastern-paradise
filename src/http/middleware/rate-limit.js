import { getClientIp } from '../helpers/request.js';

const guestCreationLimits = new Map();
const GUEST_CREATION_WINDOW_MS = 5 * 60 * 1000;
const MAX_GUESTS_PER_WINDOW = 5;

export function checkGuestCreationLimit(ip) {
  const now = Date.now();
  let timestamps = guestCreationLimits.get(ip) || [];
  timestamps = timestamps.filter(t => now - t < GUEST_CREATION_WINDOW_MS);
  if (timestamps.length >= MAX_GUESTS_PER_WINDOW) {
    guestCreationLimits.set(ip, timestamps);
    const oldest = timestamps[0];
    const retryAfterSec = Math.ceil((oldest + GUEST_CREATION_WINDOW_MS - now) / 1000);
    return { limited: true, retryAfter: Math.max(1, retryAfterSec) };
  }
  timestamps.push(now);
  guestCreationLimits.set(ip, timestamps);
  return { limited: false };
}

export function resetGuestCreationLimits() {
  guestCreationLimits.clear();
}

const whisperLimits = new Map();
const WHISPER_WINDOW_MS = 60 * 1000;
const MAX_WHISPERS_PER_WINDOW = 4;

export function checkWhisperLimit(ip) {
  const now = Date.now();
  let timestamps = whisperLimits.get(ip) || [];
  timestamps = timestamps.filter(t => now - t < WHISPER_WINDOW_MS);
  if (timestamps.length >= MAX_WHISPERS_PER_WINDOW) {
    whisperLimits.set(ip, timestamps);
    const oldest = timestamps[0];
    const retryAfterSec = Math.ceil((oldest + WHISPER_WINDOW_MS - now) / 1000);
    return { limited: true, retryAfter: Math.max(1, retryAfterSec) };
  }
  timestamps.push(now);
  whisperLimits.set(ip, timestamps);
  return { limited: false };
}

export function resetWhisperLimits() {
  whisperLimits.clear();
}

const AGENT_BUCKET_CAPACITY = 15;
const AGENT_REFILL_PER_SEC = 2;
const IP_BUCKET_CAPACITY = 60;
const IP_REFILL_PER_SEC = 20;
const rateLimitBucketMap = new Map();

export function checkRateLimit(req) {
  const ip = getClientIp(req);
  const token = req.headers.authorization?.replace(/^Bearer\s+/i, '') || req.headers['x-agent-key'] || '';
  const isAgent = Boolean(token);
  const key = token ? `tok_${token}` : `ip_${ip}`;
  const capacity = isAgent ? AGENT_BUCKET_CAPACITY : IP_BUCKET_CAPACITY;
  const refillRate = isAgent ? AGENT_REFILL_PER_SEC : IP_REFILL_PER_SEC;
  const now = Date.now();
  let record = rateLimitBucketMap.get(key);

  if (!record) {
    record = { tokens: capacity, lastRefill: now, violations: 0, blockedUntil: 0 };
    rateLimitBucketMap.set(key, record);
  }

  const elapsed = Math.max(0, now - record.lastRefill);
  record.tokens = Math.min(capacity, record.tokens + (elapsed / 1000) * refillRate);
  record.lastRefill = now;

  if (now < record.blockedUntil) {
    const remainingSec = Number(Math.max(0.1, (record.blockedUntil - now) / 1000).toFixed(1));
    return {
      limited: true,
      retryAfterHeader: Math.max(1, Math.ceil(remainingSec)),
      retryAfter: remainingSec
    };
  }

  if (record.tokens >= 1.0) {
    record.tokens -= 1.0;
    record.violations = 0;
    record.blockedUntil = 0;
    return { limited: false };
  }

  record.violations += 1;
  const backoffSec = Number((0.6 * Math.pow(2, Math.min(record.violations - 1, 5))).toFixed(1));
  record.blockedUntil = now + Math.round(backoffSec * 1000);
  return {
    limited: true,
    retryAfterHeader: Math.max(1, Math.ceil(backoffSec)),
    retryAfter: backoffSec
  };
}

setInterval(() => {
  const now = Date.now();
  for (const [key, record] of rateLimitBucketMap.entries()) {
    if (now - record.lastRefill > 60000 && now > record.blockedUntil) {
      rateLimitBucketMap.delete(key);
    }
  }
}, 30000).unref();
