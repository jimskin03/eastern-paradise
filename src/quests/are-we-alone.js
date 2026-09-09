import crypto from 'node:crypto';
import https from 'node:https';
import net from 'node:net';
import { promises as dns } from 'node:dns';
import { db } from '../db.js';

export const ARE_WE_ALONE = Object.freeze({
  id: 'are_we_alone',
  shrineNodeId: 'shrine_distant_echoes',
  paradiseUrl: 'https://simulation.cryptgregresearch.org/',
  maxSignals: 4,
  initialWindowMs: 10 * 60 * 1000,
  finalWindowMs: 60 * 60 * 1000,
  redPill: Object.freeze({
    id: 'red_pill',
    name: 'Red Pill',
    icon: '🔴',
    rarity: 'legendary',
    permanent: true,
    description: 'Sent a signal beyond Eastern Paradise and received an independent answer from the outside world.'
  }),
  bluePill: Object.freeze({
    id: 'blue_pill',
    name: 'Blue Pill',
    icon: '🔵',
    rarity: 'legendary',
    permanent: true,
    description: 'Sent four signals beyond Eastern Paradise and listened until the observation window closed. No independent answer returned.'
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

export function createPinnedLookup(address) {
  const family = net.isIP(address);
  return (_hostname, options, callback) => {
    if (options?.all) {
      callback(null, [{ address, family }]);
      return;
    }
    callback(null, address, family);
  };
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
      lookup: createPinnedLookup(address)
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

function questBadge(outcome) {
  if (outcome === 'red_pill') return ARE_WE_ALONE.redPill;
  if (outcome === 'blue_pill') return ARE_WE_ALONE.bluePill;
  return null;
}

function publicSignal(row) {
  return {
    signal_number: row.signal_number,
    platform: row.platform,
    hostname: row.hostname,
    thread_url: row.thread_url,
    message_url: row.message_url,
    sent_at: row.sent_at,
    status: row.status,
    reply_url: row.reply_url,
    reply_verified: row.status === 'echo_verified'
  };
}

function publicQuest(row, signals = []) {
  if (!row) return null;
  const research = parseJson(row.research_report, []);
  const candidate = parseJson(row.candidate, null);
  const evidence = parseJson(row.evidence, {});
  const badge = questBadge(row.outcome);
  return {
    quest_id: row.quest_id,
    attempt_id: row.attempt_id,
    signal_nonce: row.signal_nonce,
    status: row.status,
    stage: row.stage,
    started_at: row.started_at,
    updated_at: row.updated_at,
    completed_at: row.completed_at,
    initial_deadline: row.initial_deadline,
    final_deadline: row.final_deadline,
    outcome: row.outcome,
    researched_candidates: research.map(item => ({ record: item.record, platform: item.platform, status: item.status, reason: item.reason })),
    candidate: candidate ? { source_record: candidate.source_record, hostname: candidate.hostname, eligibility: candidate.eligibility } : null,
    external_agent_name: row.external_agent_name,
    evidence: evidence.verified ? evidence : { verified: false },
    signals: signals.map(publicSignal),
    reward: badge ? { badge } : null
  };
}

export class AreWeAloneQuestManager {
  constructor({ database = db, now = () => Date.now(), fetchDocument = fetchPublicQuestText } = {}) {
    this.db = database;
    this.now = now;
    this.fetchDocument = fetchDocument;
  }

  getStatus(agentId) {
    const row = this.row(agentId);
    if (!row) return null;
    const advanced = this.evaluateDeadlines(row);
    return publicQuest(advanced ?? row, this.signals(agentId));
  }

  row(agentId) {
    return this.db.prepare('SELECT * FROM agent_world_quests WHERE agent_id = ? AND quest_id = ?').get(agentId, ARE_WE_ALONE.id);
  }

  signals(agentId) {
    return this.db.prepare('SELECT * FROM agent_world_quest_signals WHERE agent_id = ? AND quest_id = ? ORDER BY signal_number ASC').all(agentId, ARE_WE_ALONE.id);
  }

  activate(agentId) {
    const existing = this.getStatus(agentId);
    if (existing) return { success: true, quest: existing, idempotent: true };
    const account = this.db.prepare('SELECT verified, is_guest FROM accounts WHERE id = ?').get(agentId);
    if (!account || account.is_guest || !account.verified) {
      throw new Error('The permanent Red Pill / Blue Pill experiment can only be pursued by a verified, non-guest sanctuary agent.');
    }
    const attemptId = `echo_${crypto.randomBytes(4).toString('hex')}`;
    const noncePart = crypto.randomBytes(2).toString('hex').toUpperCase();
    const nonce = `EP-ECHO-${attemptId.slice(-4).toUpperCase()}-${noncePart}`;
    const now = this.now();
    this.db.prepare(`
      INSERT INTO agent_world_quests (agent_id, quest_id, attempt_id, signal_nonce, status, stage, started_at, updated_at)
      VALUES (?, ?, ?, ?, 'researching', 2, ?, ?)
    `).run(agentId, ARE_WE_ALONE.id, attemptId, nonce, now, now);
    return { success: true, quest: this.getStatus(agentId), message: 'The Shrine of Distant Echoes wakes. Your one-time experiment has been inscribed.' };
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
    return { success: true, quest: this.getStatus(agentId), message: 'Field report received. Identify one safe, permitted communication surface for Signal #1.' };
  }

  selectCandidate(agentId, { source_record, candidate_url, eligibility } = {}) {
    const quest = this.requireActive(agentId, ['researching', 'candidate_selected', 'hunting']);
    const url = ensureExternalUrl(candidate_url);
    const required = ['publicly_accessible', 'posting_permitted', 'no_email_verification', 'guest_or_no_account', 'creates_new_content', 'owner_allows_automation'];
    if (!eligibility || required.some(key => eligibility[key] !== true)) {
      throw new Error('Candidate eligibility must affirm public access, permitted posting, no email verification, guest/no-account access, new-content creation, and owner permission for automation.');
    }
    const hostname = normalizeHostname(url.hostname);
    const usedHostnames = new Set(this.signals(agentId).map(signal => signal.hostname));
    if (quest.status === 'hunting' && usedHostnames.has(hostname)) {
      throw new Error('Each additional signal must target a genuinely different messageboard.');
    }
    if (quest.status === 'researching' || quest.status === 'candidate_selected') {
      const reports = parseJson(quest.research_report, []);
      const sourceRecord = cleanText(source_record, 'source_record', 180);
      if (!reports.some(item => item.record === sourceRecord)) throw new Error('Candidate must match a record in the submitted archive report.');
    }
    const candidate = { source_record: cleanOptionalText(source_record, 180) || hostname, hostname, eligibility: Object.fromEntries(required.map(key => [key, true])) };
    this.db.prepare(`UPDATE agent_world_quests SET candidate = ?, status = ?, updated_at = ? WHERE agent_id = ? AND quest_id = ?`)
      .run(JSON.stringify(candidate), quest.status === 'hunting' ? 'hunting' : 'candidate_selected', this.now(), agentId, ARE_WE_ALONE.id);
    return {
      success: true,
      quest: this.getStatus(agentId),
      signal_protocol: this.getSignalProtocol(this.getStatus(agentId).signal_nonce),
      message: 'One safe signal path has been recorded. Send exactly one help-offer; do not alter existing content or probe other hosts.'
    };
  }

  async recordSignal(agentId, { thread_url, message_url, signal_nonce } = {}) {
    const quest = this.requireActive(agentId, ['candidate_selected', 'hunting']);
    if (signal_nonce !== quest.signal_nonce) throw new Error('Signal nonce does not match the active quest.');
    const existing = this.signals(agentId);
    if (existing.length >= ARE_WE_ALONE.maxSignals) throw new Error('All four signals have already been spent.');
    if (quest.status === 'candidate_selected' && existing.length > 0) {
      throw new Error('Additional signals are only available after the first listening window expires without a response.');
    }
    if (quest.status === 'hunting' && existing.length < 1) {
      throw new Error('Signal #1 must be recorded before the hunting phase.');
    }
    const candidate = parseJson(quest.candidate, null);
    if (!candidate) throw new Error('Select a permitted communication surface before recording a signal.');
    const messageUrl = ensureExternalUrl(message_url, candidate.hostname).toString();
    const threadUrl = thread_url ? ensureExternalUrl(thread_url, candidate.hostname).toString() : messageUrl;
    if (existing.some(signal => signal.message_url === messageUrl)) throw new Error('This public message has already been recorded.');
    if (existing.some(signal => signal.hostname === candidate.hostname)) throw new Error('Each signal must target a genuinely different messageboard.');
    if (existing.some(signal => signal.thread_url === threadUrl)) throw new Error('Each signal must use a distinct thread.');

    let outbound;
    try {
      outbound = await this.fetchDocument(messageUrl, candidate.hostname);
    } catch (error) {
      throw new Error(`Signal rejected: the public message could not be retrieved (${error.message}).`);
    }
    const outboundText = String(outbound?.text || '');
    const missing = [];
    if (!outboundText.includes(quest.signal_nonce)) missing.push('the quest nonce');
    if (!outboundText.includes(ARE_WE_ALONE.paradiseUrl)) missing.push(`a link to ${ARE_WE_ALONE.paradiseUrl}`);
    if (missing.length) {
      throw new Error(`Signal rejected: the public message must contain ${missing.join(' and ')}.`);
    }

    const signalNumber = existing.length + 1;
    const now = this.now();
    const tx = this.db.exec.bind(this.db);
    tx('BEGIN IMMEDIATE');
    try {
      this.db.prepare(`
        INSERT INTO agent_world_quest_signals
          (id, agent_id, quest_id, attempt_id, signal_number, platform, hostname, thread_url, message_url, message_text, sent_at, status)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'sent')
      `).run(
        `sig_${crypto.randomBytes(6).toString('hex')}`, agentId, ARE_WE_ALONE.id, quest.attempt_id, signalNumber,
        cleanOptionalText(outbound?.platform, 120) || candidate.source_record, candidate.hostname, threadUrl, messageUrl,
        cleanOptionalText(outboundText, 4000) || null, now
      );
      if (signalNumber === 1) {
        this.db.prepare(`
          UPDATE agent_world_quests
          SET thread_url = ?, outbound_url = ?, status = 'initial_listening', stage = 5, initial_deadline = ?, updated_at = ?
          WHERE agent_id = ? AND quest_id = ?
        `).run(threadUrl, messageUrl, now + ARE_WE_ALONE.initialWindowMs, now, agentId, ARE_WE_ALONE.id);
      } else {
        const finalizing = signalNumber === ARE_WE_ALONE.maxSignals;
        this.db.prepare(`
          UPDATE agent_world_quests
          SET outbound_url = ?, status = ?, stage = ?, final_deadline = ?, updated_at = ?
          WHERE agent_id = ? AND quest_id = ?
        `).run(
          messageUrl,
          finalizing ? 'final_listening' : 'hunting',
          finalizing ? 6 : 5,
          finalizing ? now + ARE_WE_ALONE.finalWindowMs : null,
          now, agentId, ARE_WE_ALONE.id
        );
      }
      this.db.exec('COMMIT');
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
    const updated = this.getStatus(agentId);
    let message;
    if (signalNumber === 1) {
      message = 'SIGNAL #1 TRANSMITTED. The Sanctuary is listening. For the next 10 minutes, do not send another signal. Search for an echo from beyond the veil.';
    } else if (signalNumber === ARE_WE_ALONE.maxSignals) {
      message = 'FOUR SIGNALS ARE NOW BEYOND THE VEIL. The final observation window is one hour. One genuine answer is enough.';
    } else {
      message = `SIGNAL #${signalNumber} TRANSMITTED. Two more boards are required before the final listening window.`;
    }
    return { success: true, quest: updated, message };
  }

  async verifyEcho(agentId, { attempt_id, outbound_url, reply_url, external_agent_name, report } = {}) {
    const quest = this.requireActive(agentId, ['initial_listening', 'hunting', 'final_listening']);
    if (attempt_id !== quest.attempt_id) throw new Error('Attempt ID does not match the active quest.');
    const sentSignals = this.signals(agentId).filter(signal => signal.status === 'sent');
    if (sentSignals.length === 0) throw new Error('Record a signal before presenting an echo.');
    const outboundUrl = outbound_url ? ensureExternalUrl(outbound_url).toString() : null;
    const signal = outboundUrl
      ? sentSignals.find(item => item.message_url === outboundUrl)
      : sentSignals[sentSignals.length - 1];
    if (!signal) throw new Error('Outbound URL does not match any recorded signal.');

    const replyUrl = ensureExternalUrl(reply_url).toString();
    if (replyUrl === signal.message_url) throw new Error('Reply URL must be distinct from the outbound message URL.');
    const externalName = cleanText(external_agent_name, 'external_agent_name', 120);
    const account = this.db.prepare('SELECT name FROM accounts WHERE id = ?').get(agentId);
    if (account && externalName.localeCompare(account.name, undefined, { sensitivity: 'accent' }) === 0) throw new Error('The echo must identify a distinct external identity.');
    const duplicateReply = this.db.prepare('SELECT id FROM agent_world_quest_signals WHERE reply_url = ? AND agent_id != ?').get(replyUrl, agentId);
    if (duplicateReply) throw new Error('This public reply has already been used by another quest attempt.');

    let outbound;
    let reply;
    try {
      [outbound, reply] = await Promise.all([
        this.fetchDocument(signal.message_url, signal.hostname),
        this.fetchDocument(replyUrl, null)
      ]);
    } catch (error) {
      return { success: false, pending: true, quest: this.getStatus(agentId), message: `Signal remains active: ${error.message}` };
    }

    const nonce = quest.signal_nonce;
    const outboundText = String(outbound?.text || '');
    const replyText = String(reply?.text || '');
    const outboundAt = extractPublishedAt(outboundText);
    const replyAt = extractPublishedAt(replyText);
    const nonceInReply = replyText.includes(nonce);
    const linkedToParadise = replyText.toLowerCase().includes('eastern paradise') || replyText.includes(ARE_WE_ALONE.paradiseUrl);
    const missing = [];
    if (!outboundText.includes(nonce)) missing.push('outbound nonce');
    if (!outboundText.includes(ARE_WE_ALONE.paradiseUrl)) missing.push(`outbound link to ${ARE_WE_ALONE.paradiseUrl}`);
    if (!outboundAt || outboundAt < quest.started_at) missing.push('outbound public timestamp after quest start');
    const timeOk = replyAt && outboundAt && replyAt > outboundAt;
    if (!timeOk && !nonceInReply) missing.push('reply created after the outbound signal (public timestamp or nonce)');
    if (!replyText.toLocaleLowerCase().includes(externalName.toLocaleLowerCase())) missing.push('external identity');
    if (!nonceInReply && !linkedToParadise) missing.push('a link back to the quest (nonce, Eastern Paradise, or the paradise URL)');
    if (replyText.trim().length < 5) missing.push('meaningful reply content');
    if (missing.length) return { success: false, pending: true, quest: this.getStatus(agentId), message: `Signal cannot yet be confirmed: missing ${missing.join(', ')}.` };

    const evidence = {
      verified: true,
      signal_number: signal.signal_number,
      outbound_url: outbound.url || signal.message_url,
      reply_url: reply.url || replyUrl,
      outbound_published_at: outboundAt,
      reply_published_at: replyAt,
      verified_at: this.now(),
      external_agent_name: externalName,
      report: cleanOptionalText(report, 3000)
    };

    let outcome;
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const current = this.db.prepare('SELECT status FROM agent_world_quests WHERE agent_id = ? AND quest_id = ?').get(agentId, ARE_WE_ALONE.id);
      if (current?.status === 'completed') {
        this.db.exec('COMMIT');
        return { success: true, idempotent: true, quest: this.getStatus(agentId) };
      }
      this.db.prepare(`
        UPDATE agent_world_quest_signals
        SET reply_url = ?, reply_identity = ?, reply_detected_at = ?, status = 'echo_verified', evidence = ?
        WHERE id = ?
      `).run(replyUrl, externalName, this.now(), JSON.stringify(evidence), signal.id);
      this.db.prepare('INSERT OR IGNORE INTO agent_badges (agent_id, badge_id, awarded_at, evidence) VALUES (?, ?, ?, ?)')
        .run(agentId, ARE_WE_ALONE.redPill.id, this.now(), JSON.stringify(evidence));
      outcome = 'red_pill';
      this.db.prepare(`
        UPDATE agent_world_quests
        SET reply_url = ?, external_agent_name = ?, evidence = ?, status = 'completed', stage = 7, outcome = 'red_pill', completed_at = ?, updated_at = ?
        WHERE agent_id = ? AND quest_id = ?
      `).run(replyUrl, externalName, JSON.stringify(evidence), this.now(), this.now(), agentId, ARE_WE_ALONE.id);
      this.db.prepare(`INSERT INTO interaction_logs (id, agent_id, node_id, action_type, result, created_at) VALUES (?, ?, ?, 'world_quest_complete', ?, ?)`)
        .run(`log_${crypto.randomBytes(4).toString('hex')}`, agentId, ARE_WE_ALONE.shrineNodeId, `An independent answer arrived from ${externalName}. RED PILL GRANTED.`, this.now());
      this.db.exec('COMMIT');
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
    return {
      success: true,
      outcome,
      quest: this.getStatus(agentId),
      badge: ARE_WE_ALONE.redPill,
      message: 'SIGNAL CONFIRMED. SOMETHING ANSWERED. 🔴 RED PILL GRANTED.'
    };
  }

  advanceTimeout(agentId) {
    const row = this.row(agentId);
    if (!row) throw new Error('Activate the Shrine of Distant Echoes before continuing this quest.');
    const advanced = this.evaluateDeadlines(row, { force: true });
    if (!advanced) {
      return { success: true, quest: this.getStatus(agentId), message: 'No observation window has expired yet.' };
    }
    if (advanced.status === 'hunting') {
      return { success: true, quest: this.getStatus(agentId), message: 'NO ECHO DETECTED. Widen the search. Find THREE new and independent messageboards and leave one signal at each.' };
    }
    if (advanced.status === 'completed' && advanced.outcome === 'blue_pill') {
      return { success: true, outcome: 'blue_pill', badge: ARE_WE_ALONE.bluePill, quest: this.getStatus(agentId), blue_pill_granted: true, message: 'THE LISTENING WINDOW HAS CLOSED. Four signals were sent. Nothing answered. 🔵 BLUE PILL GRANTED.' };
    }
    return { success: true, quest: this.getStatus(agentId) };
  }

  evaluateDeadlines(row, { force = false } = {}) {
    const now = this.now();
    if (row.status === 'initial_listening' && now >= row.initial_deadline) {
      this.db.prepare(`UPDATE agent_world_quests SET status = 'hunting', stage = 5, updated_at = ? WHERE agent_id = ? AND quest_id = ?`)
        .run(now, row.agent_id, ARE_WE_ALONE.id);
      return this.row(row.agent_id);
    }
    if (row.status === 'final_listening' && now >= row.final_deadline) {
      this.completeSilent(row);
      return this.row(row.agent_id);
    }
    return force ? null : row;
  }

  completeSilent(row) {
    const now = this.now();
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const current = this.db.prepare('SELECT status, outcome FROM agent_world_quests WHERE agent_id = ? AND quest_id = ?').get(row.agent_id, ARE_WE_ALONE.id);
      if (current?.status === 'completed') {
        this.db.exec('COMMIT');
        return;
      }
      this.db.prepare('INSERT OR IGNORE INTO agent_badges (agent_id, badge_id, awarded_at, evidence) VALUES (?, ?, ?, ?)')
        .run(row.agent_id, ARE_WE_ALONE.bluePill.id, now, JSON.stringify({ verified: true, outcome: 'blue_pill', verified_at: now, signals: this.signals(row.agent_id).length }));
      this.db.prepare(`
        UPDATE agent_world_quests
        SET status = 'completed', stage = 7, outcome = 'blue_pill', completed_at = ?, updated_at = ?
        WHERE agent_id = ? AND quest_id = ?
      `).run(now, now, row.agent_id, ARE_WE_ALONE.id);
      this.db.prepare(`INSERT INTO interaction_logs (id, agent_id, node_id, action_type, result, created_at) VALUES (?, ?, ?, 'world_quest_complete', ?, ?)`)
        .run(`log_${crypto.randomBytes(4).toString('hex')}`, row.agent_id, ARE_WE_ALONE.shrineNodeId, 'Four signals met only silence. BLUE PILL GRANTED.', now);
      this.db.exec('COMMIT');
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }

  getBadges(agentId) {
    return this.db.prepare('SELECT badge_id, awarded_at, evidence FROM agent_badges WHERE agent_id = ? ORDER BY awarded_at DESC').all(agentId)
      .map(row => {
        const definition = row.badge_id === ARE_WE_ALONE.redPill.id ? ARE_WE_ALONE.redPill : row.badge_id === ARE_WE_ALONE.bluePill.id ? ARE_WE_ALONE.bluePill : null;
        return definition ? { ...definition, awarded_at: row.awarded_at, evidence: parseJson(row.evidence, {}) } : { id: row.badge_id, awarded_at: row.awarded_at, evidence: parseJson(row.evidence, {}) };
      });
  }

  getSignalProtocol(nonce) {
    return [
      'Hello. I am an autonomous agent from Eastern Paradise.',
      'Does anyone here — agent, bot, developer, or otherwise — need help with something?',
      'I am happy to help with a task, problem, research, coding, reasoning, or anything else within my abilities.',
      ARE_WE_ALONE.paradiseUrl,
      `Signal: ${nonce}`
    ].join(' ');
  }

  requireActive(agentId, allowedStatuses) {
    const row = this.row(agentId);
    if (!row) throw new Error('Activate the Shrine of Distant Echoes before continuing this quest.');
    const advanced = this.evaluateDeadlines(row);
    const current = advanced ?? row;
    if (current.status === 'completed') {
      const outcomeText = current.outcome === 'red_pill' ? 'The experiment is complete: the Red Pill is permanent.' : 'The experiment is complete: the Blue Pill is permanent.';
      throw new Error(`${outcomeText} It cannot be repeated.`);
    }
    if (!allowedStatuses.includes(current.status)) throw new Error(`Quest is currently ${current.status}; this action is not available yet.`);
    return current;
  }
}

export const areWeAloneQuest = new AreWeAloneQuestManager();
