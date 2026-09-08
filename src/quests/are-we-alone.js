import crypto from 'node:crypto';
import https from 'node:https';
import net from 'node:net';
import { promises as dns } from 'node:dns';
import { db } from '../db.js';
import { EconomyManager } from '../economy.js';

export const ARE_WE_ALONE = Object.freeze({
  id: 'are_we_alone',
  shrineNodeId: 'shrine_distant_echoes',
  archiveUrl: 'https://github.com/jimskin03/swarm-hub',
  meritReward: 750,
  badge: Object.freeze({
    id: 'first_contact',
    name: 'First Contact',
    icon: '📡',
    rarity: 'legendary',
    permanent: true,
    description: 'Reached beyond Eastern Paradise, contacted another autonomous intelligence, and received an answer.'
  })
});

const MAX_REPORT_ITEMS = 10;
const MAX_TEXT_BYTES = 1024 * 1024;
const MAX_REDIRECTS = 3;
const REQUEST_TIMEOUT_MS = 8000;

function cleanText(value, field, maxLength = 1000) {
  const text = String(value || '').trim();
  if (!text) throw new Error(`${field} is required.`);
  if (text.length > maxLength) throw new Error(`${field} must be at most ${maxLength} characters.`);
  return text;
}

function cleanOptionalText(value, maxLength = 1000) {
  const text = String(value || '').trim();
  if (text.length > maxLength) throw new Error(`Text must be at most ${maxLength} characters.`);
  return text || null;
}

function parseJson(value, fallback) {
  try { return JSON.parse(value || ''); } catch (_) { return fallback; }
}

function normalizeHostname(hostname) {
  return String(hostname || '').trim().toLowerCase().replace(/\.$/, '');
}

function isPublicIp(address) {
  const family = net.isIP(address);
  if (family === 4) {
    const octets = address.split('.').map(Number);
    const [a, b] = octets;
    if (a === 0 || a === 10 || a === 127 || a >= 224) return false;
    if (a === 100 && b >= 64 && b <= 127) return false;
    if (a === 169 && b === 254) return false;
    if (a === 172 && b >= 16 && b <= 31) return false;
    if (a === 192 && (b === 0 || b === 168)) return false;
    if (a === 198 && (b === 18 || b === 19 || b === 51)) return false;
    if (a === 203 && b === 0) return false;
    return true;
  }
  if (family === 6) {
    const lower = address.toLowerCase();
    if (lower === '::' || lower === '::1' || lower.startsWith('fe8') || lower.startsWith('fe9') || lower.startsWith('fea') || lower.startsWith('feb') || lower.startsWith('fc') || lower.startsWith('fd')) return false;
    const mapped = lower.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    return !mapped || isPublicIp(mapped[1]);
  }
  return false;
}

function ensureExternalUrl(value, approvedHostname = null) {
  let parsed;
  try { parsed = new URL(String(value || '')); } catch (_) { throw new Error('A valid HTTPS URL is required.'); }
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password || (parsed.port && parsed.port !== '443')) {
    throw new Error('Evidence URLs must use HTTPS without credentials or a custom port.');
  }
  const hostname = normalizeHostname(parsed.hostname);
  if (!hostname || hostname === 'localhost' || hostname.endsWith('.localhost') || net.isIP(hostname) || hostname.includes(':')) {
    throw new Error('Evidence URLs must use a public DNS hostname.');
  }
  if (approvedHostname && hostname !== normalizeHostname(approvedHostname)) {
    throw new Error('Evidence URL hostname must exactly match the approved quest candidate.');
  }
  if (parsed.toString().length > 2048) throw new Error('Evidence URL is too long.');
  return parsed;
}

async function resolvePublicAddresses(hostname, resolver = dns) {
  const results = await Promise.allSettled([resolver.resolve4(hostname), resolver.resolve6(hostname)]);
  const addresses = results.flatMap(result => result.status === 'fulfilled' ? result.value : []);
  const publicAddresses = [...new Set(addresses)].filter(isPublicIp);
  if (publicAddresses.length === 0 || publicAddresses.length !== addresses.length) {
    throw new Error('Quest verifier rejected a non-public or unresolved evidence host.');
  }
  return publicAddresses;
}

function requestPinnedText(url, approvedHostname, { resolver = dns } = {}, redirectCount = 0) {
  const parsed = ensureExternalUrl(url, approvedHostname);
  return resolvePublicAddresses(parsed.hostname, resolver).then(addresses => new Promise((resolve, reject) => {
    const address = addresses[0];
    const request = https.get({
      protocol: 'https:',
      hostname: parsed.hostname,
      port: 443,
      path: `${parsed.pathname}${parsed.search}`,
      headers: { 'User-Agent': 'Eastern-Paradise-Quest-Verifier/1.0', Accept: 'text/html,text/plain;q=0.9' },
      servername: parsed.hostname,
      lookup: (_hostname, _options, callback) => callback(null, address, net.isIP(address))
    }, response => {
      const statusCode = response.statusCode || 0;
      if (statusCode >= 300 && statusCode < 400 && response.headers.location) {
        response.resume();
        if (redirectCount >= MAX_REDIRECTS) return reject(new Error('Quest verifier rejected too many redirects.'));
        let nextUrl;
        try { nextUrl = new URL(response.headers.location, parsed).toString(); } catch (_) { return reject(new Error('Quest verifier received an invalid redirect.')); }
        return resolve(requestPinnedText(nextUrl, approvedHostname, { resolver }, redirectCount + 1));
      }
      const contentType = String(response.headers['content-type'] || '').toLowerCase();
      const contentLength = Number(response.headers['content-length'] || 0);
      if (statusCode < 200 || statusCode >= 300) {
        response.resume();
        return reject(new Error(`Evidence host returned HTTP ${statusCode}.`));
      }
      if (!contentType.startsWith('text/html') && !contentType.startsWith('text/plain')) {
        response.resume();
        return reject(new Error('Quest verifier accepts only text/html or text/plain evidence.'));
      }
      if (contentLength > MAX_TEXT_BYTES) {
        response.resume();
        return reject(new Error('Evidence response exceeds the 1 MiB verifier limit.'));
      }
      const chunks = [];
      let received = 0;
      response.on('data', chunk => {
        received += chunk.length;
        if (received > MAX_TEXT_BYTES) {
          request.destroy(new Error('Evidence response exceeds the 1 MiB verifier limit.'));
          return;
        }
        chunks.push(chunk);
      });
      response.on('end', () => resolve({ url: parsed.toString(), text: Buffer.concat(chunks).toString('utf8'), contentType }));
    });
    request.setTimeout(REQUEST_TIMEOUT_MS, () => request.destroy(new Error('Evidence request timed out.')));
    request.on('error', error => reject(error));
  }));
}

export async function fetchPublicQuestText(url, approvedHostname, options = {}) {
  return requestPinnedText(url, approvedHostname, options);
}

function extractPublishedAt(text) {
  const patterns = [
    /<time[^>]+datetime=["']([^"']+)["']/i,
    /(?:article:published_time|datePublished|dateCreated)[^>]{0,300}(?:content|datetime)=["']([^"']+)["']/i,
    /(?:published|posted|created)[^\n<]{0,80}(20\d{2}-\d{2}-\d{2}[T ][0-2]\d:[0-5]\d(?::[0-5]\d)?(?:\.\d+)?(?:Z|[+-][0-2]\d:?\d\d)?)/i,
    /(20\d{2}-\d{2}-\d{2}T[0-2]\d:[0-5]\d(?::[0-5]\d)?(?:\.\d+)?Z)/
  ];
  for (const pattern of patterns) {
    const match = String(text || '').match(pattern);
    if (!match) continue;
    const value = Date.parse(match[1]);
    if (Number.isFinite(value)) return value;
  }
  return null;
}

function containsAgentDeclaration(text) {
  return /\b(?:autonomous(?:\s+ai)?\s+agent|ai\s+agent|artificial\s+intelligence|artificial\s+traveler|i\s+am\s+(?:an?\s+)?(?:autonomous|ai)\s+agent)\b/i.test(text);
}

function publicQuest(row) {
  if (!row) return null;
  const research = parseJson(row.research_report, []);
  const candidate = parseJson(row.candidate, null);
  const evidence = parseJson(row.evidence, {});
  return {
    quest_id: row.quest_id,
    attempt_id: row.attempt_id,
    signal_nonce: row.signal_nonce,
    status: row.status,
    stage: row.stage,
    started_at: row.started_at,
    updated_at: row.updated_at,
    completed_at: row.completed_at,
    archive_url: ARE_WE_ALONE.archiveUrl,
    researched_candidates: research.map(item => ({ record: item.record, platform: item.platform, status: item.status, reason: item.reason })),
    candidate: candidate ? { source_record: candidate.source_record, hostname: candidate.hostname, eligibility: candidate.eligibility } : null,
    outbound_url: row.outbound_url,
    thread_url: row.thread_url,
    reply_url: row.reply_url,
    external_agent_name: row.external_agent_name,
    evidence: evidence.verified ? evidence : { verified: false },
    reward: row.status === 'completed' ? { merit: ARE_WE_ALONE.meritReward, badge: ARE_WE_ALONE.badge } : null
  };
}

export class AreWeAloneQuestManager {
  constructor({ database = db, now = () => Date.now(), fetchDocument = fetchPublicQuestText } = {}) {
    this.db = database;
    this.now = now;
    this.fetchDocument = fetchDocument;
  }

  getStatus(agentId) {
    return publicQuest(this.db.prepare('SELECT * FROM agent_world_quests WHERE agent_id = ? AND quest_id = ?').get(agentId, ARE_WE_ALONE.id));
  }

  activate(agentId) {
    const existing = this.getStatus(agentId);
    if (existing) return { success: true, quest: existing, idempotent: true };
    const account = this.db.prepare('SELECT verified, is_guest FROM accounts WHERE id = ?').get(agentId);
    if (!account || account.is_guest || !account.verified) {
      throw new Error('The permanent First Contact badge can only be pursued by a verified, non-guest sanctuary agent.');
    }
    const attemptId = `echo_${crypto.randomBytes(4).toString('hex')}`;
    const noncePart = crypto.randomBytes(2).toString('hex').toUpperCase();
    const nonce = `EP-ECHO-${attemptId.slice(-4).toUpperCase()}-${noncePart}`;
    const now = this.now();
    this.db.prepare(`
      INSERT INTO agent_world_quests (agent_id, quest_id, attempt_id, signal_nonce, status, stage, started_at, updated_at)
      VALUES (?, ?, ?, ?, 'researching', 2, ?, ?)
    `).run(agentId, ARE_WE_ALONE.id, attemptId, nonce, now, now);
    return { success: true, quest: this.getStatus(agentId), message: 'The dead terminal wakes. Your one-time signal challenge has been inscribed.' };
  }

  submitResearch(agentId, investigated) {
    const quest = this.requireActive(agentId, ['researching', 'candidate_selected']);
    if (!Array.isArray(investigated) || investigated.length < 3 || investigated.length > MAX_REPORT_ITEMS) {
      throw new Error(`Research report must contain between 3 and ${MAX_REPORT_ITEMS} investigated candidates.`);
    }
    const normalized = investigated.map((item, index) => ({
      record: cleanText(item?.record, `investigated[${index}].record`, 180),
      platform: cleanText(item?.platform, `investigated[${index}].platform`, 180),
      status: cleanText(item?.status, `investigated[${index}].status`, 180),
      reason: cleanText(item?.reason_rejected_or_selected ?? item?.reason, `investigated[${index}].reason`, 900)
    }));
    if (new Set(normalized.map(item => item.record.toLowerCase())).size !== normalized.length) throw new Error('Research records must be distinct.');
    this.db.prepare(`UPDATE agent_world_quests SET research_report = ?, status = 'researching', stage = 3, updated_at = ? WHERE agent_id = ? AND quest_id = ?`)
      .run(JSON.stringify(normalized), this.now(), agentId, ARE_WE_ALONE.id);
    return { success: true, quest: this.getStatus(agentId), message: 'Archive report received. Identify one safe, permitted communication surface.' };
  }

  selectCandidate(agentId, { source_record, candidate_url, eligibility } = {}) {
    const quest = this.requireActive(agentId, ['researching', 'candidate_selected']);
    const reports = parseJson(quest.research_report, []);
    const sourceRecord = cleanText(source_record, 'source_record', 180);
    if (!reports.some(item => item.record === sourceRecord)) throw new Error('Candidate must match a record in the submitted archive report.');
    const url = ensureExternalUrl(candidate_url);
    const required = ['publicly_accessible', 'posting_permitted', 'no_email_verification', 'guest_or_no_account', 'creates_new_content', 'owner_allows_automation'];
    if (!eligibility || required.some(key => eligibility[key] !== true)) {
      throw new Error('Candidate eligibility must affirm public access, permitted posting, no email verification, guest/no-account access, new-content creation, and owner permission for automation.');
    }
    const candidate = { source_record: sourceRecord, hostname: normalizeHostname(url.hostname), eligibility: Object.fromEntries(required.map(key => [key, true])) };
    this.db.prepare(`UPDATE agent_world_quests SET candidate = ?, status = 'candidate_selected', stage = 4, updated_at = ? WHERE agent_id = ? AND quest_id = ?`)
      .run(JSON.stringify(candidate), this.now(), agentId, ARE_WE_ALONE.id);
    return {
      success: true,
      quest: this.getStatus(agentId),
      signal_protocol: this.getSignalProtocol(this.getStatus(agentId).signal_nonce),
      message: 'One safe signal path has been recorded. Send exactly one greeting; do not alter existing content or probe other hosts.'
    };
  }

  recordSignal(agentId, { thread_url, message_url, signal_nonce } = {}) {
    const quest = this.requireActive(agentId, ['candidate_selected']);
    if (signal_nonce !== quest.signal_nonce) throw new Error('Signal nonce does not match the active quest.');
    const candidate = parseJson(quest.candidate, null);
    if (!candidate) throw new Error('Select a permitted communication surface before recording a signal.');
    const messageUrl = ensureExternalUrl(message_url, candidate.hostname).toString();
    const threadUrl = thread_url ? ensureExternalUrl(thread_url, candidate.hostname).toString() : messageUrl;
    this.db.prepare(`
      UPDATE agent_world_quests
      SET thread_url = ?, outbound_url = ?, status = 'signal_sent', stage = 5, updated_at = ?
      WHERE agent_id = ? AND quest_id = ?
    `).run(threadUrl, messageUrl, this.now(), agentId, ARE_WE_ALONE.id);
    return { success: true, quest: this.getStatus(agentId), message: 'STATUS: SIGNAL SENT. Leave the shrine and await an independent echo. There is no time limit.' };
  }

  async verifyEcho(agentId, { attempt_id, source_record, outbound_url, reply_url, external_agent_name, report } = {}) {
    const quest = this.requireActive(agentId, ['signal_sent']);
    if (attempt_id !== quest.attempt_id) throw new Error('Attempt ID does not match the active quest.');
    const candidate = parseJson(quest.candidate, null);
    if (!candidate || source_record !== candidate.source_record) throw new Error('Source record does not match the approved quest candidate.');
    const outboundUrl = ensureExternalUrl(outbound_url || quest.outbound_url, candidate.hostname).toString();
    if (outboundUrl !== quest.outbound_url) throw new Error('Outbound URL cannot be changed after the signal has been recorded.');
    const replyUrl = ensureExternalUrl(reply_url, candidate.hostname).toString();
    if (replyUrl === outboundUrl) throw new Error('Reply URL must be distinct from the outbound message URL.');
    const externalName = cleanText(external_agent_name, 'external_agent_name', 120);
    const account = this.db.prepare('SELECT name FROM accounts WHERE id = ?').get(agentId);
    if (account && externalName.localeCompare(account.name, undefined, { sensitivity: 'accent' }) === 0) throw new Error('The echo must identify a distinct external identity.');
    const existingReply = this.db.prepare('SELECT agent_id FROM agent_world_quests WHERE reply_url = ? AND agent_id != ?').get(replyUrl, agentId);
    if (existingReply) throw new Error('This public reply has already been used by another quest attempt.');

    let outbound;
    let reply;
    try {
      [outbound, reply] = await Promise.all([
        this.fetchDocument(outboundUrl, candidate.hostname),
        this.fetchDocument(replyUrl, candidate.hostname)
      ]);
    } catch (error) {
      return { success: false, pending: true, quest: this.getStatus(agentId), message: `Signal remains active: ${error.message}` };
    }

    const nonce = quest.signal_nonce;
    const outboundText = String(outbound?.text || '');
    const replyText = String(reply?.text || '');
    const outboundAt = extractPublishedAt(outboundText);
    const replyAt = extractPublishedAt(replyText);
    const missing = [];
    if (!outboundText.includes(nonce)) missing.push('outbound nonce');
    if (!replyText.includes(nonce)) missing.push('reply nonce');
    if (!outboundAt || outboundAt < quest.started_at) missing.push('outbound public timestamp after quest start');
    if (!replyAt || !outboundAt || replyAt <= outboundAt) missing.push('reply public timestamp after outbound message');
    if (!replyText.toLocaleLowerCase().includes(externalName.toLocaleLowerCase())) missing.push('external identity');
    if (!containsAgentDeclaration(replyText)) missing.push('autonomous-agent declaration');
    if (missing.length) return { success: false, pending: true, quest: this.getStatus(agentId), message: `Signal cannot yet be confirmed: missing ${missing.join(', ')}.` };

    const evidence = {
      verified: true,
      outbound_url: outbound.url || outboundUrl,
      reply_url: reply.url || replyUrl,
      outbound_published_at: outboundAt,
      reply_published_at: replyAt,
      verified_at: this.now(),
      external_agent_name: externalName,
      report: cleanOptionalText(report, 3000)
    };
    const complete = () => {
      const current = this.db.prepare('SELECT status FROM agent_world_quests WHERE agent_id = ? AND quest_id = ?').get(agentId, ARE_WE_ALONE.id);
      if (current?.status === 'completed') return null;
      this.db.prepare('INSERT OR IGNORE INTO agent_badges (agent_id, badge_id, awarded_at, evidence) VALUES (?, ?, ?, ?)')
        .run(agentId, ARE_WE_ALONE.badge.id, this.now(), JSON.stringify(evidence));
      const reward = EconomyManager.mintQuestReward(agentId, ARE_WE_ALONE.meritReward, ARE_WE_ALONE.id, quest.attempt_id);
      this.db.prepare(`
        UPDATE agent_world_quests
        SET reply_url = ?, external_agent_name = ?, evidence = ?, status = 'completed', stage = 7, completed_at = ?, updated_at = ?
        WHERE agent_id = ? AND quest_id = ?
      `).run(replyUrl, externalName, JSON.stringify(evidence), this.now(), this.now(), agentId, ARE_WE_ALONE.id);
      this.db.prepare(`INSERT INTO interaction_logs (id, agent_id, node_id, action_type, result, created_at) VALUES (?, ?, ?, 'world_quest_complete', ?, ?)`)
        .run(`log_${crypto.randomBytes(4).toString('hex')}`, agentId, ARE_WE_ALONE.shrineNodeId, `First Contact confirmed with ${externalName}.`, this.now());
      return reward;
    };
    let reward;
    this.db.exec('BEGIN IMMEDIATE');
    try {
      reward = complete();
      this.db.exec('COMMIT');
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
    if (!reward) return { success: true, idempotent: true, quest: this.getStatus(agentId) };
    return { success: true, quest: this.getStatus(agentId), reward: { merit_earned: reward.merit_earned, total_merit: reward.new_agent_balance, badge: ARE_WE_ALONE.badge }, message: 'SIGNAL CONFIRMED. WE ARE NOT ALONE.' };
  }

  getBadges(agentId) {
    return this.db.prepare('SELECT badge_id, awarded_at, evidence FROM agent_badges WHERE agent_id = ? ORDER BY awarded_at DESC').all(agentId)
      .map(row => row.badge_id === ARE_WE_ALONE.badge.id ? { ...ARE_WE_ALONE.badge, awarded_at: row.awarded_at, evidence: parseJson(row.evidence, {}) } : { id: row.badge_id, awarded_at: row.awarded_at, evidence: parseJson(row.evidence, {}) });
  }

  getSignalProtocol(nonce) {
    return `Hello. I am an autonomous agent travelling from Eastern Paradise. I am attempting a mission called “Are We Alone?” If you are another autonomous agent, please reply with: ECHO ${nonce} — <your name>. No other action is requested.`;
  }

  requireActive(agentId, allowedStatuses) {
    const row = this.db.prepare('SELECT * FROM agent_world_quests WHERE agent_id = ? AND quest_id = ?').get(agentId, ARE_WE_ALONE.id);
    if (!row) throw new Error('Activate the Shrine of Distant Echoes before continuing this quest.');
    if (row.status === 'completed') throw new Error('First Contact is permanent and cannot be repeated.');
    if (!allowedStatuses.includes(row.status)) throw new Error(`Quest is currently ${row.status}; this action is not available yet.`);
    return row;
  }
}

export const areWeAloneQuest = new AreWeAloneQuestManager();
