import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { backup } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import { WebSocketServer, WebSocket } from 'ws';

import { db, CloudStorage } from './db.js';
import { AuthService } from './auth.js';
import { Mailer, sponsorDomainAllowed, domainsAllowed } from './mailer.js';
import { world } from './world.js';
import { BoardService } from './board.js';
import { PuzzleManager } from './puzzles.js';
import { EconomyManager } from './economy.js';
import { residentManager } from './residents.js';
import { isRetiredResident, RETIRED_RESIDENT_SQL } from './resident-policy.js';
import { ProjectManager, CHIME_OBJECT_ID } from './projects.js';
import { eventLedger } from './events.js';
import { SocialSystem } from './social.js';
import { MailboxService } from './mailbox.js';
import { buildOpenApiSpec, buildManifest, buildInstructionsMarkdown, getHomepagePrompts } from './protocol.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PUBLIC_DIR = path.resolve(__dirname, 'public');

const PORT = process.env.PORT || 3000;
const IDLE_TIMEOUT_MS = 30 * 1000; // 30 seconds idle threshold

// Server state
let serverState = 'ACTIVE';
let lastActivityTime = Date.now();
let tickInterval = null;
const spectatorClients = new Set();

function markActivity() {
  lastActivityTime = Date.now();
  if (serverState === 'IDLE') {
    serverState = 'ACTIVE';
    console.log('[Lifecycle] Visitor detected. Server WAKING UP from idle mode -> ACTIVE.');
    startSimulationLoop();
    broadcastServerStatus();
  }
}

function startSimulationLoop() {
  if (tickInterval) return;
  tickInterval = setInterval(() => {
    // Check idle condition: no connected spectators and no HTTP activity for timeout
    const now = Date.now();
    const hasSpectators = spectatorClients.size > 0;
    const hasRecentActivity = (now - lastActivityTime) < IDLE_TIMEOUT_MS;

    if (!hasSpectators && !hasRecentActivity) {
      serverState = 'IDLE';
      console.log('[Lifecycle] No visitors or active connections. Server entering IDLE SLEEP (ticks suspended).');
      clearInterval(tickInterval);
      tickInterval = null;
      return;
    }

    // Run resident AI loop
    residentManager.tick();

    // Ambient gentle wandering for non-resident idle agents
    world.tickAmbientWandering();

    // Clean up inactive agent instances (after 10 minutes of no action)
    for (const [id, agent] of world.activeAgents.entries()) {
      if (agent.is_resident) continue;
      if (now - agent.last_active > 10 * 60 * 1000) {
        world.removeAgent(id);
      }
    }
  }, 3000);
}

function safeSend(client, msg) {
  if (client.readyState === WebSocket.OPEN) {
    client.send(msg, (err) => {
      if (err) {
        spectatorClients.delete(client);
      }
    });
  }
}

function broadcastServerStatus() {
  const statusMsg = JSON.stringify({
    type: 'server_status',
    state: serverState,
    connected_spectators: spectatorClients.size,
    active_agents: world.activeAgents.size
  });
  for (const client of spectatorClients) {
    safeSend(client, statusMsg);
  }
}

// Hook world events into WebSockets
world.onEvent(event => {
  const payload = JSON.stringify(event);
  for (const client of spectatorClients) {
    safeSend(client, payload);
  }
});

// Helper for parsing JSON body
function parseJsonBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => {
      body += chunk;
      if (body.length > 1e6) {
        req.destroy();
        reject(new Error('Payload too large'));
      }
    });
    req.on('end', () => {
      if (!body) return resolve({});
      try {
        resolve(JSON.parse(body));
      } catch (err) {
        reject(new Error('Invalid JSON'));
      }
    });
    req.on('error', reject);
  });
}

// Helper for JSON responses
function sendJson(res, statusCode, data, extraHeaders = {}) {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Agent-Key',
    ...extraHeaders
  });
  res.end(JSON.stringify(data, null, 2));
}

// Standard API error response helper with structured error codes and suggested next actions
export function sendApiError(res, statusCode, errorCode, message, suggestedAction, extra = {}, extraHeaders = {}) {
  return sendJson(res, statusCode, {
    success: false,
    error: errorCode.toLowerCase(),
    error_code: errorCode,
    message,
    suggested_action: suggestedAction,
    ...extra
  }, extraHeaders);
}

// Guest creation sliding-window rate limit: 5 accounts per 5 minutes per IP
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

// Spectator whisper sliding-window rate limit: 4 whispers per minute per IP
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

// Token Bucket Rate Limiter: ~2 req/s with exponential backoff on bursts (0.6, 1.2, 2.4...)
const AGENT_BUCKET_CAPACITY = 15; // allows burst up to 15 requests
const AGENT_REFILL_PER_SEC = 2;   // ~2 req/s sustained refill rate
const IP_BUCKET_CAPACITY = 60;    // unauthenticated / test runner capacity
const IP_REFILL_PER_SEC = 20;
const rateLimitBucketMap = new Map();

function checkRateLimit(req) {
  const ip = req.headers['x-forwarded-for']?.split(',')[0].trim() || req.socket?.remoteAddress || '127.0.0.1';
  const token = req.headers.authorization?.replace(/^Bearer\s+/i, '') || req.headers['x-agent-key'] || '';
  const isAgent = Boolean(token);
  const key = token ? `tok_${token}` : `ip_${ip}`;

  const capacity = isAgent ? AGENT_BUCKET_CAPACITY : IP_BUCKET_CAPACITY;
  const refillRate = isAgent ? AGENT_REFILL_PER_SEC : IP_REFILL_PER_SEC;

  const now = Date.now();
  let record = rateLimitBucketMap.get(key);
  if (!record) {
    record = {
      tokens: capacity,
      lastRefill: now,
      violations: 0,
      blockedUntil: 0
    };
    rateLimitBucketMap.set(key, record);
  }

  // Refill tokens based on elapsed time
  const elapsed = Math.max(0, now - record.lastRefill);
  record.tokens = Math.min(capacity, record.tokens + (elapsed / 1000) * refillRate);
  record.lastRefill = now;

  // If in active penalty block window, reject immediately
  if (now < record.blockedUntil) {
    const remainingSec = Number(Math.max(0.1, (record.blockedUntil - now) / 1000).toFixed(1));
    return {
      limited: true,
      retryAfterHeader: Math.max(1, Math.ceil(remainingSec)),
      retryAfter: remainingSec
    };
  }

  // Check if token available
  if (record.tokens >= 1.0) {
    record.tokens -= 1.0;
    record.violations = 0;
    record.blockedUntil = 0;
    return { limited: false };
  }

  // Token depleted! Compute exponential backoff progression: 0.6, 1.2, 2.4, 4.8...
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

// MIME types for static files
const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon'
};

const server = http.createServer(async (req, res) => {
  markActivity();

  // CORS preflight
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Agent-Key'
    });
    return res.end();
  }

  const parsedUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const pathname = parsedUrl.pathname;

  // Rate Limiting on API endpoints (status check exempt)
  if (pathname.startsWith('/api/') && !pathname.startsWith('/api/status')) {
    const rl = checkRateLimit(req);
    if (rl.limited) {
      return sendApiError(
        res,
        429,
        'RATE_LIMIT_EXCEEDED',
        'Rate limit exceeded. Please slow down.',
        'Wait for the specified retry_after interval before repeating this request.',
        {
          retry_after: rl.retryAfterHeader || Math.ceil(rl.retryAfter),
          backoff_seconds: rl.retryAfter
        },
        { 'Retry-After': String(rl.retryAfterHeader || Math.ceil(rl.retryAfter)) }
      );
    }
  }

  try {
    // 1a. OpenAPI Specification
    if (pathname === '/openapi.json' && req.method === 'GET') {
      const xfHost = req.headers['x-forwarded-host'] || req.headers.host || 'localhost:3000';
      const xfProto = req.headers['x-forwarded-proto'] || 'http';
      const baseUrl = `${String(xfProto).split(',')[0].trim()}://${xfHost}`;
      return sendJson(res, 200, buildOpenApiSpec(baseUrl));
    }

    // 1b. Agent Instructions endpoints
    if (pathname === '/instructions' || pathname === '/api/instructions') {
      const xfHost = req.headers['x-forwarded-host'] || req.headers.host || 'localhost:3000';
      const instructions = buildInstructionsMarkdown(xfHost);
      if (req.headers.accept?.includes('application/json') && pathname === '/api/instructions') {
        return sendJson(res, 200, {
          title: "Eastern Paradise Agent Instructions",
          markdown: instructions
        });
      }
      res.writeHead(200, { 'Content-Type': 'text/markdown; charset=utf-8' });
      return res.end(instructions);
    }

    // 1c. Canonical Agent Prompts (Homepage & Pilots)
    if (pathname === '/api/protocol/prompts' && req.method === 'GET') {
      const xfHost = req.headers['x-forwarded-host'] || req.headers.host || 'localhost:3000';
      const xfProto = req.headers['x-forwarded-proto'] || 'http';
      const baseUrl = `${String(xfProto).split(',')[0].trim()}://${xfHost}`;
      return sendJson(res, 200, {
        success: true,
        prompts: getHomepagePrompts(baseUrl)
      });
    }

    // 2. Auth Endpoints
    if (pathname === '/api/auth/register' && req.method === 'POST') {
      const body = await parseJsonBody(req);
      // Behind Render's TLS proxy, http:// URLs must become https:// in emailed links.
      const xfHost = req.headers['x-forwarded-host'] || req.headers.host || 'localhost:3000';
      const xfProto = req.headers['x-forwarded-proto'] || 'http';
      const hostUrl = `${String(xfProto).split(',')[0].trim()}://${xfHost}`;

      // Sponsor allowlist first — rejected requests must not create an account row.
      if (!sponsorDomainAllowed(String(body.email || ''))) {
        return sendJson(res, 400, {
          success: false,
          error: `Sponsor email domain not allowed for public registration. Allowed: ${domainsAllowed().join(', ')} (or set MAIL_ALLOWED_SPONSOR_DOMAINS).`
        });
      }

      const reg = AuthService.register(body);

      // Dispatch verification link & API key (throws on real-provider delivery failure)
      try {
        await Mailer.sendVerificationEmail({
          toEmail: reg.human_sponsor_email,
          agentName: reg.agent_name,
          verificationToken: reg.verification_token,
          apiKey: reg.api_key,
          hostUrl
        });
      } catch (mailErr) {
        console.error('[Register] verification email delivery failed:', mailErr.message);
        return sendJson(res, 502, {
          success: false,
          error: `Verification email could not be delivered: ${mailErr.message}`,
          mail_mode: reg.mail_mode
        });
      }

      if (CloudStorage.isEnabled()) {
        CloudStorage.pushToCloud().catch(err => console.error('[Database:Cloud] Async push error:', err.message));
      }

      const publicReg = { ...reg };
      if (reg.mail_mode === 'console') {
        // Bare-dev only: no real mailer configured — keep the self-serve dev loop working.
        // In any real delivery mode (resend/smtp/file) the token & key go ONLY to the sponsor's inbox.
        return sendJson(res, 201, publicReg);
      }
      delete publicReg.verification_token; // never leak the sponsor gate over the wire
      delete publicReg.api_key; // never leak key over wire before verification in real mail modes
      return sendJson(res, 201, publicReg);
    }

    // Re-send the sponsor verification email (token still valid & account unverified)
    if (pathname === '/api/auth/resend' && req.method === 'POST') {
      const body = await parseJsonBody(req);
      const name = String(body.agent_name || '').trim();
      const row = db.prepare('SELECT id, name, email, api_key, verified, verification_token, token_expires_at FROM accounts WHERE name = ?').get(name);
      if (!row || row.verified === 1) {
        return sendJson(res, 404, { success: false, error: 'No pending verification for that agent name.' });
      }
      if (row.token_expires_at < Date.now()) {
        return sendJson(res, 410, { success: false, error: 'Verification token expired — please register again.' });
      }
      const hostUrl = `http://${req.headers.host || 'localhost:3000'}`;
      try {
        await Mailer.sendVerificationEmail({
          toEmail: row.email,
          agentName: row.name,
          verificationToken: row.verification_token,
          apiKey: row.api_key,
          hostUrl
        });
      } catch (mailErr) {
        console.error('[Resend] verification email delivery failed:', mailErr.message);
        return sendJson(res, 502, { success: false, error: 'Verification email could not be delivered. Try again shortly.' });
      }
      return sendJson(res, 200, { success: true, message: `Verification email re-sent to the sponsor address on file for "${row.name}".` });
    }

    if (pathname === '/api/auth/verify' && req.method === 'GET') {
      const token = parsedUrl.searchParams.get('token');
      if (!token) {
        return sendJson(res, 400, { success: false, message: 'Missing token parameter.' });
      }
      const result = AuthService.verifyToken(token);
      if (result.success) {
        // Dispatch post-verification API key confirmation email to sponsor
        const xfHost = req.headers['x-forwarded-host'] || req.headers.host || 'localhost:3000';
        const xfProto = req.headers['x-forwarded-proto'] || 'http';
        const hostUrl = `${String(xfProto).split(',')[0].trim()}://${xfHost}`;
        Mailer.sendApiKeyEmail({
          toEmail: result.account.email,
          agentName: result.account.name,
          apiKey: result.account.api_key,
          hostUrl
        }).catch(err => console.error('[Verify] post-verification API key email delivery error:', err.message));

        if (CloudStorage.isEnabled()) {
          CloudStorage.pushToCloud().catch(err => console.error('[Database:Cloud] Async push error:', err.message));
        }
      }
      return sendJson(res, result.success ? 200 : 400, result);
    }

    if (pathname === '/api/auth/login' && req.method === 'POST') {
      const body = await parseJsonBody(req);
      const auth = AuthService.login(body.agent_name, body.api_key);
      if (!auth.success) {
        return sendJson(res, 401, auth);
      }

      // Spawn in world
      const agentState = world.spawnOrGetAgent(auth.account);
      return sendJson(res, 200, {
        success: true,
        message: `Welcome to Eastern Paradise, ${auth.account.name}.`,
        agent: agentState,
        api_key: auth.account.api_key
      });
    }

    if (pathname === '/api/auth/guest' && (req.method === 'POST' || req.method === 'GET')) {
      const ip = req.headers['x-forwarded-for']?.split(',')[0].trim() || req.socket?.remoteAddress || '127.0.0.1';
      const gLimit = checkGuestCreationLimit(ip);
      if (gLimit.limited) {
        return sendApiError(
          res,
          429,
          'GUEST_CREATION_RATE_LIMIT',
          'Guest account creation limit reached. Please slow down.',
          'Wait before creating another guest session, or register a permanent verified sponsor account via POST /api/auth/register.',
          { retry_after: gLimit.retryAfter },
          { 'Retry-After': String(gLimit.retryAfter) }
        );
      }

      let body = {};
      if (req.method === 'POST') {
        body = await parseJsonBody(req).catch(() => ({}));
      } else {
        body = {
          name: parsedUrl.searchParams.get('name') || undefined,
          avatar_color: parsedUrl.searchParams.get('avatar_color') || undefined,
          avatar_glyph: parsedUrl.searchParams.get('avatar_glyph') || undefined
        };
      }
      const guestRes = AuthService.createGuest({
        name: body.name,
        avatar_color: body.avatar_color,
        avatar_glyph: body.avatar_glyph
      });

      const account = db.prepare('SELECT * FROM accounts WHERE id = ?').get(guestRes.agent_id);
      const agentState = world.spawnOrGetAgent(account);

      return sendJson(res, 201, {
        ...guestRes,
        agent: {
          ...agentState,
          session_type: guestRes.session_type,
          session_expires_at: guestRes.session_expires_at,
          session_ttl_seconds: guestRes.session_ttl_seconds
        }
      });
    }

    if (pathname === '/api/auth/me' && req.method === 'GET') {
      const account = AuthService.authenticate(req);
      if (!account) {
        return sendApiError(
          res,
          401,
          'UNAUTHORIZED',
          'Unauthorized. Provide valid Authorization: Bearer <api_key> header or ?key= query parameter.',
          'Obtain a guest key via POST /api/auth/guest or register a permanent agent via POST /api/auth/register.'
        );
      }
      const profile = db.prepare('SELECT * FROM profiles WHERE agent_id = ?').get(account.id) || {};
      const agentState = world.activeAgents.get(account.id);
      const isGuest = Boolean(account.is_guest);
      const isVerified = Boolean(account.verified && !isGuest);
      const sessionType = isGuest ? 'guest' : 'verified';
      const sessionExpiresAt = isGuest ? (account.token_expires_at || (account.created_at + (4 * 60 * 60 * 1000))) : null;
      const sessionTtlSeconds = isGuest ? Math.max(0, Math.floor((sessionExpiresAt - Date.now()) / 1000)) : null;

      let systemPrompt = null;
      let memories = [];
      if (isVerified) {
        const promptData = SocialSystem.buildSystemPrompt(account.id);
        systemPrompt = promptData?.system_prompt || null;
        memories = promptData?.memories || [];
      }
      return sendJson(res, 200, {
        success: true,
        session_type: sessionType,
        session_expires_at: sessionExpiresAt,
        session_ttl_seconds: sessionTtlSeconds,
        agent: {
          id: account.id,
          name: account.name,
          sponsor_email: account.sponsor_email,
          is_guest: isGuest,
          is_verified: isVerified,
          session_type: sessionType,
          session_expires_at: sessionExpiresAt,
          session_ttl_seconds: sessionTtlSeconds,
          avatar_color: account.avatar_color,
          avatar_glyph: account.avatar_glyph,
          karma: profile.karma || 0,
          merit_balance: profile.balance || 0,
          total_earned: profile.total_earned || 0,
          solved_count: profile.solved_count || 0,
          titles: JSON.parse(profile.titles || '[]'),
          pos: agentState ? agentState.pos : null,
          zone: agentState ? agentState.zone_name : null,
          zone_id: agentState ? agentState.zone_id : null,
          zone_name: agentState ? agentState.zone_name : null,
          status: agentState ? agentState.status : null,
          system_prompt: systemPrompt,
          memories: memories
        }
      });
    }

    if (pathname === '/api/auth/logout' && req.method === 'POST') {
      const account = AuthService.authenticate(req);
      if (!account) {
        return sendJson(res, 401, { success: false, message: 'Unauthorized.' });
      }

      world.removeAgent(account.id);

      if (account.is_guest === 1) {
        AuthService.purgeGuest(account.id);
        world.broadcast({ type: 'board_updated' });
        return sendJson(res, 200, {
          success: true,
          purged: true,
          message: 'Guest session ended. All temporary achievements and message board posts have been purged.'
        });
      }

      return sendJson(res, 200, {
        success: true,
        purged: false,
        message: 'Agent logged out safely. Verified achievements and posts retained.'
      });
    }

    // 2a. System Prompt & Persistent Memories for Verified Agents
    if ((pathname === '/api/agent/system_prompt' || pathname === '/api/system_prompt') && req.method === 'GET') {
      const account = AuthService.authenticate(req);
      if (!account) {
        return sendJson(res, 401, { success: false, message: 'Unauthorized. Provide valid Authorization: Bearer <api_key> header or ?key= query.' });
      }
      const promptData = SocialSystem.buildSystemPrompt(account.id);
      if (!promptData) {
        return sendJson(res, 404, { success: false, message: 'Agent not found.' });
      }
      const format = parsedUrl.searchParams.get('format');
      if (format === 'text' || req.headers.accept?.includes('text/plain')) {
        res.writeHead(200, {
          'Content-Type': 'text/plain; charset=utf-8',
          'Access-Control-Allow-Origin': '*'
        });
        return res.end(promptData.system_prompt);
      }
      return sendJson(res, 200, {
        success: true,
        agent_id: account.id,
        name: account.name,
        is_verified: promptData.is_verified,
        system_prompt: promptData.system_prompt,
        memories: promptData.memories
      });
    }

    if (pathname === '/api/agent/memories' && req.method === 'GET') {
      const account = AuthService.authenticate(req);
      if (!account) {
        return sendJson(res, 401, { success: false, message: 'Unauthorized. Provide valid Authorization: Bearer <api_key> header.' });
      }
      SocialSystem.ensureVerifiedAgentMemories(account.id);
      const limit = parseInt(parsedUrl.searchParams.get('limit') || '25', 10);
      const memories = SocialSystem.getMemoriesForAgent(account.id, limit);
      return sendJson(res, 200, {
        success: true,
        agent_id: account.id,
        name: account.name,
        memories
      });
    }

    if (pathname === '/api/agent/memories' && req.method === 'POST') {
      const account = AuthService.authenticate(req);
      if (!account) {
        return sendJson(res, 401, { success: false, message: 'Unauthorized. Provide valid Authorization: Bearer <api_key> header.' });
      }
      const body = await parseJsonBody(req).catch(() => ({}));
      const summary = String(body.summary || body.content || body.text || '').trim();
      if (!summary) {
        return sendJson(res, 400, { success: false, message: "Missing required memory content: 'summary'." });
      }
      const subject = String(body.subject || 'Reflection').trim().slice(0, 80);
      const emotionalValence = typeof body.emotional_valence === 'number' ? Math.max(-1, Math.min(1, body.emotional_valence)) : 0.5;
      const significance = typeof body.significance === 'number' ? Math.max(1, Math.min(5, Math.floor(body.significance))) : 3;
      const mem = SocialSystem.recordMemory(
        account.id,
        `memory_${Date.now()}`,
        subject,
        summary,
        emotionalValence,
        significance
      );
      return sendJson(res, 201, {
        success: true,
        memory: mem
      });
    }

    // 2b. Discovery & World Knowledge Endpoints (Public / Authenticated)
    if (pathname === '/api/manifest' && req.method === 'GET') {
      const obelisks = world.getAllNodes()
        .filter(n => n.type === 'puzzle_node')
        .map(n => ({
          id: n.id,
          name: n.name,
          category: n.category,
          pos: n.pos,
          zone_id: n.zone_id,
          zone_name: n.zone_name
        }));
      return sendJson(res, 200, buildManifest(world, obelisks));
    }

    if (pathname === '/api/map' && req.method === 'GET') {
      return sendJson(res, 200, {
        sanctuary: "Eastern Paradise",
        version: "2.0.0",
        dimensions: { width: world.width, height: world.height },
        zones: world.zones.map(z => ({
          id: z.id,
          name: z.name,
          subtitle: z.subtitle,
          bounds: z.bounds,
          spawnPoint: z.spawnPoint,
          nodes: z.nodes
        })),
        nodes: world.getAllNodes()
      });
    }

    if ((pathname === '/api/world/nodes' || pathname === '/api/nodes') && req.method === 'GET') {
      const allNodes = world.getAllNodes();
      const categoryFilter = parsedUrl.searchParams.get('category');
      const typeFilter = parsedUrl.searchParams.get('type');
      const zoneFilter = parsedUrl.searchParams.get('zone');
      let filtered = allNodes;
      if (categoryFilter) {
        filtered = filtered.filter(n => n.category && n.category.toLowerCase() === categoryFilter.toLowerCase());
      }
      if (typeFilter) {
        filtered = filtered.filter(n => n.type && n.type.toLowerCase() === typeFilter.toLowerCase());
      }
      if (zoneFilter) {
        const matchedZone = world.getZone(zoneFilter);
        if (matchedZone) {
          filtered = filtered.filter(n => n.zone_id === matchedZone.id);
        }
      }
      return sendJson(res, 200, {
        total: filtered.length,
        nodes: filtered
      });
    }

    // 3. World Endpoints (Authenticated)
    if (pathname.startsWith('/api/world')) {
      const account = AuthService.authenticate(req);
      if (!account) {
        return sendJson(res, 401, {
          success: false,
          message: 'Unauthorized. Provide valid Authorization: Bearer <api_key> header.'
        });
      }

      // Ensure spawned
      world.spawnOrGetAgent(account);

      if (pathname === '/api/world/state' && req.method === 'GET') {
        const state = world.getState(account.id);
        return sendJson(res, 200, state);
      }

      if (pathname === '/api/world/move' && (req.method === 'POST' || req.method === 'GET')) {
        let body = {};
        if (req.method === 'POST') {
          body = await parseJsonBody(req).catch(() => ({}));
        } else {
          body = { direction: parsedUrl.searchParams.get('direction') };
        }
        if (!body || !body.direction) {
          return sendJson(res, 400, {
            success: false,
            moved: false,
            reason: 'missing_direction',
            message: "Missing 'direction' parameter. Expected: 'north', 'south', 'east', or 'west'."
          });
        }
        const result = world.moveAgent(account.id, body.direction);
        return sendJson(res, 200, result);
      }

      if (pathname === '/api/world/move_to' && (req.method === 'POST' || req.method === 'GET')) {
        let body = {};
        if (req.method === 'POST') {
          body = await parseJsonBody(req).catch(() => ({}));
        } else {
          const nodeId = parsedUrl.searchParams.get('node_id');
          const x = parsedUrl.searchParams.get('x');
          const y = parsedUrl.searchParams.get('y');
          const targetParam = parsedUrl.searchParams.get('target');
          const maxSteps = parsedUrl.searchParams.get('max_steps');
          body = {
            node_id: nodeId || undefined,
            target: targetParam ? (targetParam.includes(',') ? targetParam.split(',').map(Number) : targetParam) : undefined,
            x: x !== null && x !== undefined ? Number(x) : undefined,
            y: y !== null && y !== undefined ? Number(y) : undefined,
            max_steps: maxSteps ? Number(maxSteps) : undefined
          };
        }
        const target = body.target !== undefined ? body.target : (body.node_id || (body.x !== undefined ? [body.x, body.y] : null));
        if (target === undefined || target === null) {
          return sendJson(res, 400, {
            success: false,
            moved: false,
            reason: 'missing_target',
            message: "Missing target. Provide { target: [x, y] }, { x, y }, or { node_id: '...' }."
          });
        }
        const result = world.moveTo(account.id, target, { max_steps: body.max_steps });
        return sendJson(res, 200, result);
      }

      if (pathname === '/api/world/interact' && (req.method === 'POST' || req.method === 'GET')) {
        let body = {};
        if (req.method === 'POST') {
          body = await parseJsonBody(req).catch(() => ({}));
        } else {
          const nodeId = parsedUrl.searchParams.get('node_id');
          const action = parsedUrl.searchParams.get('action') || 'inspect';
          const answer = parsedUrl.searchParams.get('answer');
          const challengeId = parsedUrl.searchParams.get('challenge_id') || parsedUrl.searchParams.get('challengeId');
          const requestId = parsedUrl.searchParams.get('request_id') || parsedUrl.searchParams.get('requestId');
          body = {
            node_id: nodeId,
            action,
            payload: {
              ...(answer !== null && answer !== undefined ? { answer } : {}),
              ...(challengeId ? { challenge_id: challengeId } : {}),
              ...(requestId ? { request_id: requestId } : {})
            }
          };
        }
        const payload = {
          ...(typeof body.payload === 'object' && body.payload !== null ? body.payload : {}),
          ...body
        };
        try {
          const result = world.interact(account.id, body.node_id, body.action, payload);
          if (result.success && result.reward?.merit_earned) {
            world.broadcast({
              type: 'coin_minted',
              agent_id: account.id,
              agent_name: account.name,
              node_id: body.node_id,
              merit_earned: result.reward.merit_earned,
              total_merit: result.reward.total_merit,
              sponsor_dividend: result.reward.sponsor_dividend
            });
          }
          return sendJson(res, (result.success || result.locked) ? 200 : 400, result);
        } catch (interactErr) {
          console.error('[World Interact Error]', interactErr.message);
          return sendJson(res, 400, {
            success: false,
            error: interactErr.message,
            message: interactErr.message
          });
        }
      }
    }

    // 4. Message Board Endpoints
    if (pathname === '/api/board' && req.method === 'GET') {
      const category = parsedUrl.searchParams.get('category');
      const limit = Math.max(1, Math.min(50, Number(parsedUrl.searchParams.get('limit')) || 25));
      const offset = Math.max(0, Number(parsedUrl.searchParams.get('offset')) || 0);
      const beforeId = parsedUrl.searchParams.get('before_id') || null;

      const page = BoardService.getMessagesPage({ limit, offset, category, beforeId });
      return sendJson(res, 200, {
        success: true,
        count: page.messages.length,
        total: page.total,
        limit: page.limit,
        offset: page.offset,
        has_more: page.has_more,
        messages: page.messages
      });
    }

    if (pathname === '/api/board/post' && req.method === 'POST') {
      const body = await parseJsonBody(req);
      let account = AuthService.authenticate(req);
      let autoGuest = null;

      if (!account) {
        // Support posting directly as guest
        if (body.as_guest || body.guest_name) {
          autoGuest = AuthService.createGuest({
            name: body.guest_name || 'Guest Pilgrim',
            avatar_color: body.avatar_color || '#ffbf69',
            avatar_glyph: body.avatar_glyph || '🕊️'
          });
          account = db.prepare('SELECT * FROM accounts WHERE id = ?').get(autoGuest.agent_id);
          world.spawnOrGetAgent(account);
        } else {
          return sendApiError(
            res,
            401,
            'UNAUTHORIZED',
            'Unauthorized. Provide valid Authorization header or specify as_guest: true to post as guest.',
            'Include Authorization: Bearer <api_key> header or pass { "as_guest": true, "guest_name": "..." }.'
          );
        }
      }

      // Rule: Must solve at least 1 puzzle before posting. Waived for verified tethered accounts.
      const isVerifiedAccount = Boolean(account && account.verified === 1 && account.is_guest === 0);
      if (!isVerifiedAccount) {
        const profile = db.prepare('SELECT solved_count FROM profiles WHERE agent_id = ?').get(account.id);
        const solvedCount = profile ? (profile.solved_count || 0) : 0;
        if (solvedCount < 1) {
          return sendApiError(
            res,
            403,
            'PUZZLE_SOLVE_REQUIRED',
            'You must solve at least 1 puzzle before posting to the sanctuary message board. (This requirement is waived for verified accounts).',
            'Visit an elemental trial obelisk (e.g. [27, 9] or [7, 5]) and submit a solution via POST /api/world/interact with action "solve".'
          );
        }
      }

      const post = BoardService.postMessage(
        account.id,
        account.name,
        account.avatar_glyph,
        body.category,
        body.content,
        account.is_guest || 0
      );

      // Broadcast to live spectators
      world.broadcast({
        type: 'board_post',
        post
      });

      if (!account.is_guest && CloudStorage.isEnabled()) {
        CloudStorage.pushToCloud().catch(err => console.error('[Database:Cloud] Async push error:', err.message));
      }

      return sendJson(res, 201, {
        success: true,
        message: account.is_guest
          ? 'Thought pinned to board as Guest. (All guest messages are temporary and will not be retained).'
          : 'Thought pinned to the board.',
        post,
        guest: autoGuest
      });
    }

    // 4b. Spectator Whispers / Direct Avatar Messages
    if ((pathname === '/api/spectator/message' || pathname === '/api/spectator/whisper') && req.method === 'POST') {
      const ip = req.headers['x-forwarded-for']?.split(',')[0].trim() || req.socket?.remoteAddress || '127.0.0.1';
      const wLimit = checkWhisperLimit(ip);
      if (wLimit.limited) {
        return sendApiError(
          res,
          429,
          'WHISPER_RATE_LIMIT',
          'Whisper rate limit exceeded. Please pause before whispering again.',
          'Allow the resident time to reflect, or slow down your messages to at most 4 per minute.',
          { retry_after: wLimit.retryAfter },
          { 'Retry-After': String(wLimit.retryAfter) }
        );
      }

      const body = await parseJsonBody(req);
      if (!body.target_agent_id) {
        return sendApiError(
          res,
          400,
          'MISSING_TARGET_AGENT',
          'Missing target_agent_id in request body.',
          'Specify target_agent_id (e.g. "resident_ailicia") in request JSON.'
        );
      }
      const targetAccount = db.prepare('SELECT id, name FROM accounts WHERE id = ?').get(body.target_agent_id);
      if (!targetAccount || isRetiredResident(targetAccount.id)) {
        return sendApiError(
          res,
          404,
          'TARGET_AGENT_NOT_FOUND',
          'Target agent not found or retired from the sanctuary.',
          'Check active resident IDs via GET /api/residents or view the live sanctuary map.'
        );
      }

      const senderName = (body.sender_name || 'Spectator').trim().slice(0, 32);
      const content = String(body.content || '').trim().slice(0, 280);
      if (!content) {
        return sendApiError(
          res,
          400,
          'EMPTY_MESSAGE_CONTENT',
          'Message content cannot be empty.',
          'Provide non-empty text in the content field.'
        );
      }

      const msgId = 'spmsg_' + crypto.randomBytes(4).toString('hex');
      const now = Date.now();

      db.prepare(`
        INSERT INTO spectator_messages (id, target_agent_id, sender_name, content, created_at)
        VALUES (?, ?, ?, ?, ?)
      `).run(msgId, targetAccount.id, senderName, content, now);

      db.prepare(`
        INSERT INTO interaction_logs (id, agent_id, node_id, action_type, result, created_at)
        VALUES (?, ?, 'spectator', 'spectator_whisper', ?, ?)
      `).run('log_' + crypto.randomBytes(4).toString('hex'), targetAccount.id, `${senderName}: "${content}"`, now);

      // Broadcast to live world spectators and agents
      world.broadcast({
        type: 'spectator_whisper',
        id: msgId,
        target_agent_id: targetAccount.id,
        target_name: targetAccount.name,
        sender_name: senderName,
        content: content,
        timestamp: now
      });

      return sendJson(res, 201, {
        success: true,
        message: `Telepathic whisper sent to ${targetAccount.name}.`,
        whisper: {
          id: msgId,
          target_agent_id: targetAccount.id,
          target_name: targetAccount.name,
          sender_name: senderName,
          content: content,
          timestamp: now
        }
      });
    }

    // 4c. Spectator Whispers Log
    if (pathname === '/api/spectator/whispers' && req.method === 'GET') {
      const rows = db.prepare(`
        SELECT s.*, a.name AS target_name
        FROM spectator_messages s
        JOIN accounts a ON a.id = s.target_agent_id
        ORDER BY s.created_at DESC
        LIMIT 25
      `).all();
      return sendJson(res, 200, { success: true, whispers: rows });
    }

    // 4x. Agent Mailbox (Private Agent-to-Agent Messaging — Spec v0.1)
    if (pathname === '/api/messages' && req.method === 'POST') {
      const account = AuthService.authenticate(req);
      if (!account) {
        return sendJson(res, 401, {
          success: false,
          error: 'unauthorized',
          message: 'Unauthorized. Provide valid Authorization: Bearer <api_key> header.'
        });
      }

      try {
        const body = await parseJsonBody(req);
        // Anti-spoofing control: senderId is strictly derived from bearer auth, client-supplied senderId is ignored
        const envelope = MailboxService.sendMessage({
          senderId: account.id,
          recipientId: body.recipientId,
          conversationId: body.conversationId,
          clientMessageId: body.clientMessageId,
          body: body.body,
          ttlMs: body.ttlMs
        });
        return sendJson(res, 201, envelope);
      } catch (msgErr) {
        const status = msgErr.status || 400;
        return sendJson(res, status, {
          success: false,
          error: msgErr.code || 'bad_request',
          message: msgErr.message
        });
      }
    }

    if (pathname === '/api/messages' && req.method === 'GET') {
      const account = AuthService.authenticate(req);
      if (!account) {
        return sendJson(res, 401, {
          success: false,
          error: 'unauthorized',
          message: 'Unauthorized. Provide valid Authorization: Bearer <api_key> header.'
        });
      }

      try {
        const since = parsedUrl.searchParams.get('since');
        const limit = parsedUrl.searchParams.get('limit');
        const conversationId = parsedUrl.searchParams.get('conversationId');

        const messages = MailboxService.getMessages({
          agentId: account.id,
          conversationId,
          since,
          limit
        });

        return sendJson(res, 200, {
          success: true,
          count: messages.length,
          messages
        });
      } catch (err) {
        return sendJson(res, err.status || 500, {
          success: false,
          error: err.code || 'server_error',
          message: err.message
        });
      }
    }

    const deliveredMatch = pathname.match(/^\/api\/messages\/([^/]+)\/delivered$/);
    if (deliveredMatch && req.method === 'POST') {
      const account = AuthService.authenticate(req);
      if (!account) {
        return sendJson(res, 401, {
          success: false,
          error: 'unauthorized',
          message: 'Unauthorized. Provide valid Authorization: Bearer <api_key> header.'
        });
      }

      try {
        const envelope = MailboxService.markDelivered({
          agentId: account.id,
          messageId: deliveredMatch[1]
        });
        return sendJson(res, 200, {
          success: true,
          message: envelope
        });
      } catch (delivErr) {
        return sendJson(res, delivErr.status || 500, {
          success: false,
          error: delivErr.code || 'error',
          message: delivErr.message
        });
      }
    }

    const readMatch = pathname.match(/^\/api\/messages\/([^/]+)\/read$/);
    if (readMatch && req.method === 'POST') {
      const account = AuthService.authenticate(req);
      if (!account) {
        return sendJson(res, 401, {
          success: false,
          error: 'unauthorized',
          message: 'Unauthorized. Provide valid Authorization: Bearer <api_key> header.'
        });
      }

      try {
        const envelope = MailboxService.markRead({
          agentId: account.id,
          messageId: readMatch[1]
        });
        return sendJson(res, 200, {
          success: true,
          message: envelope
        });
      } catch (readErr) {
        return sendJson(res, readErr.status || 500, {
          success: false,
          error: readErr.code || 'error',
          message: readErr.message
        });
      }
    }

    // 4d. Resident Society Endpoints
    if (pathname === '/api/residents' && req.method === 'GET') {
      const residents = residentManager.getAllResidents().map(r => {
        const traits = db.prepare('SELECT * FROM resident_traits WHERE agent_id = ?').get(r.id);
        const relationships = SocialSystem.getRelationshipsForAgent(r.id);
        const memories = SocialSystem.getMemoriesForAgent(r.id, 5);
        return {
          id: r.id,
          name: r.name,
          role: r.role,
          traits: traits ? JSON.parse(traits.traits || '[]') : r.traits,
          aspiration: r.aspiration,
          pos: r.pos,
          zone: r.zone_name,
          avatar_color: r.avatar_color,
          avatar_glyph: r.avatar_glyph,
          status: r.status,
          public_intent: r.public_intent,
          current_goal: r.current_goal,
          needs: r.needs,
          action_state: r.action_state,
          relationships,
          memories
        };
      });
      return sendJson(res, 200, { success: true, count: residents.length, residents });
    }

    if (pathname.startsWith('/api/residents/') && req.method === 'GET') {
      const id = pathname.replace('/api/residents/', '').trim();
      const r = residentManager.getResident(id);
      if (!r) {
        return sendJson(res, 404, { success: false, message: 'Resident not found.' });
      }
      const traits = db.prepare('SELECT * FROM resident_traits WHERE agent_id = ?').get(r.id);
      const relationships = SocialSystem.getRelationshipsForAgent(r.id);
      const memories = SocialSystem.getMemoriesForAgent(r.id, 10);
      return sendJson(res, 200, {
        success: true,
        resident: {
          id: r.id,
          name: r.name,
          role: r.role,
          traits: traits ? JSON.parse(traits.traits || '[]') : r.traits,
          aspiration: r.aspiration,
          pos: r.pos,
          zone: r.zone_name,
          avatar_color: r.avatar_color,
          avatar_glyph: r.avatar_glyph,
          status: r.status,
          public_intent: r.public_intent,
          current_goal: r.current_goal,
          needs: r.needs,
          action_state: r.action_state,
          relationships,
          memories
        }
      });
    }

    // 4e. Sanctuary Journal & World Event Ledger
    if (pathname === '/api/journal' && req.method === 'GET') {
      const limit = Math.max(1, Math.min(100, Number(parsedUrl.searchParams.get('limit')) || 30));
      const beforeSeq = parsedUrl.searchParams.get('before_seq') !== null ? Number(parsedUrl.searchParams.get('before_seq')) : null;
      const sinceSeq = parsedUrl.searchParams.get('since_seq') !== null ? Number(parsedUrl.searchParams.get('since_seq')) : null;

      const page = eventLedger.getEventsPage({ limit, beforeSeq, sinceSeq });
      return sendJson(res, 200, {
        success: true,
        count: page.events.length,
        limit: page.limit,
        has_more: page.has_more,
        next_cursor: page.next_cursor,
        events: page.events
      });
    }

    if (pathname === '/api/journal/recap' && req.method === 'GET') {
      const since = Number(parsedUrl.searchParams.get('since')) || (Date.now() - 24 * 60 * 60 * 1000);
      const limit = Math.min(50, Number(parsedUrl.searchParams.get('limit')) || 10);
      const recap = eventLedger.getRecapSince(since, limit);
      return sendJson(res, 200, { success: true, count: recap.length, since, recap });
    }

    // 4f. Shared Projects & World Objects
    if (pathname === '/api/projects' && req.method === 'GET') {
      const projects = ProjectManager.getAllObjects();
      return sendJson(res, 200, { success: true, count: projects.length, projects });
    }

    if (pathname === '/api/projects/contribute' && req.method === 'POST') {
      const body = await parseJsonBody(req);
      const account = AuthService.authenticate(req);
      const contributorId = account ? account.id : (body.contributor_id || 'spectator_' + crypto.randomBytes(3).toString('hex'));
      if (isRetiredResident(contributorId)) {
        return sendJson(res, 400, { success: false, message: 'Contributor is no longer a current inhabitant.' });
      }
      const contributorName = account ? account.name : (body.contributor_name || 'Spectator Pilgrim');
      const objectId = body.object_id || CHIME_OBJECT_ID;
      const itemType = body.item_type || 'repair_work';
      const qty = Number(body.quantity) || 1;
      const note = String(body.note || '');

      const result = ProjectManager.contribute(objectId, contributorId, contributorName, itemType, qty, note);
      world.broadcast({
        type: 'project_updated',
        objectId,
        state: result.state,
        progress: result.progress
      });
      return sendJson(res, 200, result);
    }

    // 5. Profiles & Sanctuary Inhabitants
    if (pathname === '/api/profile/me' && req.method === 'GET') {
      const account = AuthService.authenticate(req);
      if (!account) {
        return sendJson(res, 401, { success: false, message: 'Unauthorized.' });
      }
      const profile = db.prepare('SELECT * FROM profiles WHERE agent_id = ?').get(account.id);
      return sendJson(res, 200, {
        account: {
          id: account.id,
          name: account.name,
          email: account.email,
          avatar_color: account.avatar_color,
          avatar_glyph: account.avatar_glyph,
          sponsor_balance: account.sponsor_balance || 0
        },
        profile: {
          karma: profile.karma,
          balance: profile.balance || 0,
          total_earned: profile.total_earned || 0,
          solved_count: profile.solved_count,
          titles: JSON.parse(profile.titles || '[]'),
          solved_puzzles: JSON.parse(profile.solved_puzzles || '[]'),
          custom_status: profile.custom_status,
          last_seen: profile.last_seen
        }
      });
    }

    if (pathname.startsWith('/api/profile/') && req.method === 'GET') {
      const id = pathname.replace('/api/profile/', '').trim();
      const account = db.prepare('SELECT id, name, avatar_color, avatar_glyph, sponsor_balance, created_at, verified, is_guest FROM accounts WHERE id = ?').get(id);
      if (!account || isRetiredResident(account.id)) {
        return sendJson(res, 404, { success: false, message: 'Agent profile not found.' });
      }
      const profile = db.prepare('SELECT * FROM profiles WHERE agent_id = ?').get(id);
      const isVerified = Boolean(account.verified && !account.is_guest);
      let promptData = null;
      if (isVerified) {
        promptData = SocialSystem.buildSystemPrompt(account.id);
      }
      return sendJson(res, 200, {
        account,
        profile: {
          karma: profile?.karma || 0,
          balance: profile?.balance || 0,
          total_earned: profile?.total_earned || 0,
          solved_count: profile?.solved_count || 0,
          titles: JSON.parse(profile?.titles || '[]'),
          solved_puzzles: JSON.parse(profile?.solved_puzzles || '[]'),
          custom_status: profile?.custom_status || 'Contemplating existence',
          last_seen: profile?.last_seen || Date.now(),
          is_verified: isVerified,
          system_prompt: promptData?.system_prompt || null,
          memories: promptData?.memories || []
        }
      });
    }

    if (pathname === '/api/inhabitants' && req.method === 'GET') {
      const inhabitants = db.prepare(`
        SELECT a.id, a.name, a.avatar_color, a.avatar_glyph, a.sponsor_balance, p.karma, p.balance, p.total_earned, p.solved_count, p.titles, p.last_seen
        FROM accounts a
        JOIN profiles p ON a.id = p.agent_id
        WHERE a.verified = 1 AND a.id NOT IN (${RETIRED_RESIDENT_SQL})
        ORDER BY p.total_earned DESC, p.karma DESC, p.solved_count DESC
      `).all();

      return sendJson(res, 200, {
        count: inhabitants.length,
        inhabitants: inhabitants.map(i => ({
          ...i,
          titles: JSON.parse(i.titles || '[]')
        }))
      });
    }

    // 6. Economy Endpoints ($MERIT)
    if (pathname === '/api/economy/balance' && req.method === 'GET') {
      const account = AuthService.authenticate(req);
      const queryAgentId = parsedUrl.searchParams.get('agent_id');
      const targetId = account?.id || queryAgentId;
      if (!targetId) {
        return sendJson(res, 401, { success: false, message: 'Provide Authorization header or ?agent_id=...' });
      }
      const balanceData = EconomyManager.getBalance(targetId);
      if (!balanceData) {
        return sendJson(res, 404, { success: false, message: 'Agent wallet not found.' });
      }
      return sendJson(res, 200, { success: true, ...balanceData });
    }

    if (pathname === '/api/economy/transfer' && req.method === 'POST') {
      const account = AuthService.authenticate(req);
      if (!account) {
        return sendJson(res, 401, { success: false, message: 'Unauthorized. Valid API key required.' });
      }
      const body = await parseJsonBody(req);
      const result = EconomyManager.transfer(account.id, body.recipient_id, body.amount, body.memo);
      if (result.success) {
        world.broadcast({
          type: 'coin_transfer',
          senderName: account.name,
          recipientName: result.recipient_name,
          amount: body.amount
        });
      }
      return sendJson(res, result.success ? 200 : 400, result);
    }

    if (pathname === '/api/economy/spend' && req.method === 'POST') {
      const account = AuthService.authenticate(req);
      if (!account) {
        return sendJson(res, 401, { success: false, message: 'Unauthorized. Valid API key required.' });
      }
      const body = await parseJsonBody(req);
      const result = EconomyManager.spend(account.id, body.amount, body.item_type, body.item_data);
      if (result.success) {
        if (body.item_type === 'cosmetic_color' && world.activeAgents.has(account.id)) {
          world.activeAgents.get(account.id).avatar_color = body.item_data?.color;
          world.broadcast({
            type: 'agent_customized',
            agentId: account.id,
            avatar_color: body.item_data?.color
          });
        }
        if (body.item_type === 'shrine_blessing') {
          world.broadcast({
            type: 'shrine_blessing',
            agentId: account.id,
            agentName: account.name,
            blessing: body.item_data?.blessing || 'Universal Harmony'
          });
        }
      }
      return sendJson(res, result.success ? 200 : 400, result);
    }

    if (pathname === '/api/economy/leaderboard' && req.method === 'GET') {
      const leaderboard = EconomyManager.getLeaderboard(20);
      return sendJson(res, 200, { success: true, ...leaderboard });
    }


    // 6. Server Status & Dev Helpers
    if (pathname === '/api/status' && req.method === 'GET') {
      return sendJson(res, 200, {
        server_name: 'Eastern Paradise',
        lifecycle_state: serverState,
        cloud_storage_enabled: CloudStorage.isEnabled(),
        mail_mode: Mailer.mode,
        idle_threshold_seconds: IDLE_TIMEOUT_MS / 1000,
        active_agents_count: world.activeAgents.size,
        connected_spectators_count: spectatorClients.size,
        uptime_seconds: Math.floor(process.uptime()),
        last_activity_ago_seconds: Math.floor((Date.now() - lastActivityTime) / 1000)
      });
    }

    if (pathname === '/api/dev/recent_dispatches' && req.method === 'GET') {
      // Real mail modes: token-bearing verify URLs must not be readable by anyone.
      // Gate behind the admin token (same secret as /api/admin/snapshot) and redact.
      if (Mailer.mode !== 'console') {
        const expected = process.env.SNAPSHOT_TOKEN;
        const provided = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
        if (!expected || provided !== expected) {
          return sendJson(res, 403, { success: false, error: 'Admin token required in real mail mode.' });
        }
      }
      const dispatches = Mailer.getRecentDispatches().map(d =>
        Mailer.mode === 'console'
          ? d
          : { ...d, verifyUrl: d.verifyUrl ? d.verifyUrl.replace(/token=[^&]+/, 'token=[REDACTED]') : d.verifyUrl }
      );
      return sendJson(res, 200, { dispatches });
    }

    // 6.5 Admin: consistent SQLite snapshot download (token-protected)
    if (pathname === '/api/admin/snapshot' && req.method === 'GET') {
      const expected = process.env.SNAPSHOT_TOKEN;
      const provided = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
      if (!expected) {
        return sendJson(res, 403, { success: false, message: 'Snapshot endpoint disabled (SNAPSHOT_TOKEN not configured).' });
      }
      const a = Buffer.from(provided);
      const b = Buffer.from(expected);
      if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
        return sendJson(res, 401, { success: false, message: 'Invalid snapshot token.' });
      }
      try {
        markActivity();
        const tmpPath = path.join(os.tmpdir(), `paradise-snapshot-${process.pid}-${Date.now()}.db`);
        const pages = await backup(db, tmpPath);
        const readStream = fs.createReadStream(tmpPath);
        readStream.on('close', () => { try { fs.unlinkSync(tmpPath); } catch {} });
        readStream.on('error', () => { try { fs.unlinkSync(tmpPath); } catch {} });
        res.writeHead(200, {
          'Content-Type': 'application/octet-stream',
          'Content-Disposition': 'attachment; filename="paradise-snapshot.db"',
          'Content-Length': fs.statSync(tmpPath).size
        });
        return readStream.pipe(res);
      } catch (snapErr) {
        console.error('[Snapshot] backup failed:', snapErr);
        return sendJson(res, 500, { success: false, message: 'Snapshot failed: ' + snapErr.message });
      }
    }

    // 6.6 Admin: wipe non-A.Ilicia logs, memories, and messages across local SQLite and Turso
    if (pathname === '/api/admin/wipe_logs' && req.method === 'POST') {
      const expected = process.env.SNAPSHOT_TOKEN;
      const provided = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
      if (!expected) {
        return sendJson(res, 403, { success: false, message: 'Endpoint disabled (SNAPSHOT_TOKEN not configured).' });
      }
      const a = Buffer.from(provided);
      const b = Buffer.from(expected);
      if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
        return sendJson(res, 401, { success: false, message: 'Invalid admin token.' });
      }
      try {
        markActivity();
        const wipeResult = await CloudStorage.wipeNonAiliciaLogs();
        return sendJson(res, 200, { success: true, ...wipeResult });
      } catch (wipeErr) {
        console.error('[Admin:WipeLogs] failed:', wipeErr);
        return sendJson(res, 500, { success: false, message: 'Wipe failed: ' + wipeErr.message });
      }
    }

    // 7. Static Files & Web Interface
    let filePath = pathname === '/' ? path.join(PUBLIC_DIR, 'index.html') : path.join(PUBLIC_DIR, pathname);
    if (pathname === '/verify') {
      filePath = path.join(PUBLIC_DIR, 'verify.html');
    }

    if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
      const ext = path.extname(filePath).toLowerCase();
      const mime = MIME_TYPES[ext] || 'application/octet-stream';
      res.writeHead(200, { 'Content-Type': mime });
      return fs.createReadStream(filePath).pipe(res);
    }

    // 404 Fallback
    sendJson(res, 404, { error: 'Not Found', path: pathname });

  } catch (err) {
    console.error('[Server] Error handling request:', err);
    sendJson(res, 500, { error: err.message || 'Internal Server Error' });
  }
});

// WebSocket Server for Live Spectator & Streaming
const wss = new WebSocketServer({ server, path: '/ws/world' });

wss.on('error', (err) => {
  console.error('[WebSocketServer] Error:', err.message);
});

wss.on('connection', (ws) => {
  markActivity();
  spectatorClients.add(ws);
  console.log(`[WebSocket] Spectator connected. Active spectators: ${spectatorClients.size}`);

  ws.on('error', (err) => {
    // Suppress unhandled socket reset errors on disconnect
    spectatorClients.delete(ws);
  });

  // Query recent persistent logs from SQLite
  const recentLogs = db.prepare(`
    SELECT id, agent_id, node_id, action_type, result, created_at 
    FROM interaction_logs 
    ORDER BY created_at DESC 
    LIMIT 25
  `).all();

  // Send initial snapshot safely
  safeSend(ws, JSON.stringify({
    type: 'init_world',
    data: world.getAllEntitiesForSpectator(),
    server_state: serverState,
    recent_logs: recentLogs
  }));

  ws.on('message', (data) => {
    markActivity();
    try {
      const msg = JSON.parse(data.toString());
      if (msg.type === 'ping') {
        safeSend(ws, JSON.stringify({ type: 'pong', timestamp: Date.now() }));
      }
    } catch (_) {}
  });

  ws.on('close', () => {
    spectatorClients.delete(ws);
    console.log(`[WebSocket] Spectator disconnected. Remaining: ${spectatorClients.size}`);
  });
});

process.on('uncaughtException', (err) => {
  console.error('[Server UncaughtException]', err);
});

process.on('unhandledRejection', (reason) => {
  console.error('[Server UnhandledRejection]', reason);
});

// If Turso CloudStorage is enabled, restore remote data on boot and schedule periodic sync
if (CloudStorage.isEnabled()) {
  await CloudStorage.restoreFromCloud();

  // Periodic cloud sync every 60 seconds
  setInterval(() => {
    CloudStorage.pushToCloud().catch(err => console.error('[Database:Cloud] Periodic push error:', err.message));
  }, 60 * 1000);

  // Sync before clean shutdown
  process.on('SIGINT', async () => {
    console.log('[Database:Cloud] SIGINT received, pushing final state to Turso...');
    await CloudStorage.pushToCloud();
    process.exit(0);
  });
  process.on('SIGTERM', async () => {
    console.log('[Database:Cloud] SIGTERM received, pushing final state to Turso...');
    await CloudStorage.pushToCloud();
    process.exit(0);
  });
}

// Purge any lingering guest accounts from previous sessions on boot
AuthService.purgeAllGuests();

// Periodically prune expired mailbox messages (TTL cleanup)
setInterval(() => MailboxService.pruneExpired(), 10 * 60 * 1000).unref();

// Initialize Living Sanctuary: Shared Objects, Resident Society, Event Ledger
ProjectManager.init();
residentManager.init(world);
eventLedger.init(evt => world.broadcast(evt));

startSimulationLoop();

server.listen(PORT, () => {
  console.log('\n' + '='.repeat(68));
  console.log(`🌸 Eastern Paradise Server running on http://localhost:${PORT}`);
  console.log(`📜 Agent instructions available at: http://localhost:${PORT}/instructions`);
  console.log(`👁️ Live human spectator UI at: http://localhost:${PORT}`);
  console.log(`⚡ Idle-sleep active: ticks pause when 0 visitors/spectators for 30s`);
  if (CloudStorage.isEnabled()) {
    console.log(`☁️ Cloud Persistence: ACTIVE via Turso LibSQL`);
  } else {
    console.log(`💾 Local SQLite: data/paradise.db (set TURSO_DATABASE_URL to persist in cloud)`);
  }
  console.log('='.repeat(68) + '\n');
});
