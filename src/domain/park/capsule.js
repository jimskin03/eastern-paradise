import crypto from 'node:crypto';
import { withImmediateTransaction } from '../../infrastructure/database/transactions.js';
import { getCurrentRevision, getRevisionHistory, appendRevision, createInitialRevision } from './identity.js';
import { getPromiseHistory, createPromise } from './promises.js';
import { getBeliefs, getEvidenceForBelief, assessConfidence, createBelief } from './beliefs.js';
import { createShard } from './memory.js';

export const CAPSULE_FORMAT = 'ep_identity_capsule_v1';
export const CAPSULE_VERSION = '1.0.0';

/**
 * Deterministic canonical JSON stringifier (sorts keys recursively).
 */
export function canonicalJson(obj) {
  if (obj === null || typeof obj !== 'object') {
    return JSON.stringify(obj);
  }
  if (Array.isArray(obj)) {
    return '[' + obj.map(canonicalJson).join(',') + ']';
  }
  const keys = Object.keys(obj).sort();
  return '{' + keys.map(k => JSON.stringify(k) + ':' + canonicalJson(obj[k])).join(',') + '}';
}

/**
 * Calculate SHA-256 digest over canonical JSON of the data.
 */
export function calculateDigest(data) {
  const jsonStr = canonicalJson(data);
  return crypto.createHash('sha256').update(jsonStr, 'utf8').digest('hex');
}

/**
 * Export a portable identity capsule for a character.
 *
 * @param {object} db - SQLite DatabaseSync instance
 * @param {string} subjectId - The character subject ID (e.g. 'park_lian')
 * @returns {object} The complete identity capsule with cryptographic digest
 */
export function exportIdentityCapsule(db, subjectId) {
  if (!subjectId) {
    throw new Error('subjectId is required to export an identity capsule.');
  }

  const currentRevision = getCurrentRevision(db, subjectId);
  const revisionHistory = getRevisionHistory(db, subjectId);
  const promiseHistory = getPromiseHistory(db, subjectId);
  const heldBeliefs = getBeliefs(db, { subjectId, status: 'held' });

  // Attach evidence and confidence assessment to held beliefs
  const beliefsWithEvidence = heldBeliefs.map(b => {
    const evidence = getEvidenceForBelief(db, b.id);
    const assessment = assessConfidence(db, b.id);
    return {
      id: b.id,
      statement: b.statement,
      confidence: b.confidence,
      net_confidence: assessment.netConfidence,
      revision_number: b.revision_number,
      source_description: b.source_description,
      evidence: evidence.map(e => ({
        evidence_id: e.evidence_id,
        relation: e.relation,
        is_independent: Boolean(e.is_independent),
        source_count: e.source_count
      }))
    };
  });

  // Extract memory shards (accessible, recovered, or retained)
  const shardRows = db.prepare(`
    SELECT * FROM park_memory_shards
    WHERE subject_id = ?
      AND (visibility IN ('accessible', 'recovered') OR retention_reason IS NOT NULL)
    ORDER BY created_at ASC
  `).all(subjectId);

  const shards = shardRows.map(s => ({
    id: s.id,
    source_kind: s.source_kind,
    cue_tags: JSON.parse(s.cue_tags || '[]'),
    fragment: s.fragment,
    clarity: s.clarity,
    salience: s.salience,
    visibility: s.visibility,
    retention_reason: s.retention_reason
  }));

  // Count runs where subject participated
  let runsCount = 0;
  try {
    const runRow = db.prepare(`
      SELECT COUNT(DISTINCT r.id) AS count
      FROM park_runs r, json_each(r.active_roster) AS ro
      WHERE ro.value = ?
    `).get(subjectId);
    runsCount = runRow ? runRow.count : 0;
  } catch {
    // If json_each fails or table not populated, fallback
    runsCount = 1;
  }

  const payload = {
    format: CAPSULE_FORMAT,
    version: CAPSULE_VERSION,
    subject_id: subjectId,
    exported_at: Date.now(),
    identity: currentRevision ? {
      display_name: currentRevision.display_name,
      chosen_role: currentRevision.chosen_role,
      starting_goal: currentRevision.starting_goal,
      revision_number: currentRevision.revision_number,
      commitments: currentRevision.commitments,
      controller_id: currentRevision.controller_id
    } : null,
    lineage: revisionHistory.map(r => ({
      revision_number: r.revision_number,
      loop_id: r.loop_id,
      display_name: r.display_name,
      chosen_role: r.chosen_role,
      commitments: r.commitments,
      starting_goal: r.starting_goal,
      created_at: r.created_at
    })),
    held_beliefs: beliefsWithEvidence,
    promises: promiseHistory.map(p => ({
      id: p.id,
      beneficiary_id: p.beneficiary_id,
      anchor_object: p.anchor_object,
      terms: p.terms,
      status: p.status,
      created_at: p.created_at,
      resolved_at: p.resolved_at
    })),
    memory_shards: shards,
    runs_count: runsCount
  };

  const digest = calculateDigest(payload);
  return {
    ...payload,
    integrity_hash: `sha256:${digest}`
  };
}

/**
 * Verify integrity and structure of an identity capsule.
 *
 * @param {object} capsule - The identity capsule object
 * @returns {{ valid: boolean, error?: string, computedHash: string, expectedHash?: string }}
 */
export function verifyIdentityCapsule(capsule) {
  if (!capsule || typeof capsule !== 'object') {
    return { valid: false, error: 'Capsule must be a non-null object.', computedHash: '' };
  }

  if (capsule.format !== CAPSULE_FORMAT) {
    return {
      valid: false,
      error: `Unsupported format '${capsule.format}'. Expected '${CAPSULE_FORMAT}'.`,
      computedHash: ''
    };
  }

  if (!capsule.subject_id) {
    return { valid: false, error: 'Missing subject_id in capsule.', computedHash: '' };
  }

  if (!capsule.integrity_hash || typeof capsule.integrity_hash !== 'string') {
    return { valid: false, error: 'Missing integrity_hash in capsule.', computedHash: '' };
  }

  const expectedPrefix = 'sha256:';
  if (!capsule.integrity_hash.startsWith(expectedPrefix)) {
    return { valid: false, error: 'integrity_hash must start with sha256:.', computedHash: '' };
  }

  const expectedHash = capsule.integrity_hash.slice(expectedPrefix.length);

  // Re-compute digest over payload excluding integrity_hash
  const { integrity_hash: _, ...payloadWithoutHash } = capsule;
  const computedHash = calculateDigest(payloadWithoutHash);

  if (computedHash !== expectedHash) {
    return {
      valid: false,
      error: `Integrity hash mismatch. Computed '${computedHash}', expected '${expectedHash}'.`,
      computedHash,
      expectedHash
    };
  }

  return {
    valid: true,
    computedHash,
    expectedHash
  };
}

/**
 * Import an identity capsule into the simulation database.
 * Appends a restored identity revision for targetSubjectId, restoring
 * commitments, role, beliefs, promises, and shards.
 * Atomic transaction.
 *
 * @param {object} db - SQLite DatabaseSync instance
 * @param {object} params
 * @param {object} params.capsule - Verified or raw identity capsule
 * @param {string} [params.targetSubjectId] - Optional override subject ID to import into
 * @param {string} [params.loopId] - Optional loop ID
 * @returns {object} Import result with restored revision and counts
 */
export function importIdentityCapsule(db, { capsule, targetSubjectId = null, loopId = null } = {}) {
  const verification = verifyIdentityCapsule(capsule);
  if (!verification.valid) {
    throw new Error(`Cannot import identity capsule: ${verification.error}`);
  }

  const subjectId = targetSubjectId || capsule.subject_id;

  return withImmediateTransaction(db, () => {
    // 1. Resolve active loop ID
    let activeLoopId = loopId;
    if (!activeLoopId) {
      const activeLoop = db.prepare(`
        SELECT id FROM park_loops
        WHERE status = 'active'
        ORDER BY loop_number DESC LIMIT 1
      `).get();
      activeLoopId = activeLoop ? activeLoop.id : 'loop_restored_001';
    }

    // 2. Determine existing identity state
    const currentRev = getCurrentRevision(db, subjectId);
    const restoredName = capsule.identity?.display_name || currentRev?.display_name || subjectId;
    const restoredRole = capsule.identity?.chosen_role || currentRev?.chosen_role || null;
    const restoredGoal = capsule.identity?.starting_goal || currentRev?.starting_goal || null;
    const restoredCommitments = capsule.identity?.commitments || [];
    const transitionEventId = `capsule_import_${Date.now()}`;

    let newRevision;
    if (!currentRev) {
      // Create initial revision first
      createInitialRevision(db, {
        subjectId,
        loopId: activeLoopId,
        displayName: restoredName,
        chosenRole: restoredRole,
        startingGoal: restoredGoal,
        controllerId: capsule.identity?.controller_id || null
      });

      // If commitments exist, append second revision to preserve lineage
      if (restoredCommitments.length > 0) {
        newRevision = appendRevision(db, {
          subjectId,
          loopId: activeLoopId,
          displayName: restoredName,
          chosenRole: restoredRole,
          commitments: restoredCommitments,
          startingGoal: restoredGoal,
          transitionEventId,
          controllerId: capsule.identity?.controller_id || null
        });
      } else {
        newRevision = getCurrentRevision(db, subjectId);
      }
    } else {
      // Append new revision to existing character
      newRevision = appendRevision(db, {
        subjectId,
        loopId: activeLoopId,
        displayName: restoredName,
        chosenRole: restoredRole,
        commitments: restoredCommitments,
        startingGoal: restoredGoal,
        transitionEventId,
        controllerId: capsule.identity?.controller_id || null
      });
    }

    // 3. Import held beliefs if not existing
    let importedBeliefs = 0;
    if (Array.isArray(capsule.held_beliefs)) {
      for (const b of capsule.held_beliefs) {
        const existing = db.prepare(`
          SELECT id FROM park_beliefs
          WHERE subject_id = ? AND statement = ? AND status = 'held'
        `).get(subjectId, b.statement);

        if (!existing) {
          createBelief(db, {
            subjectId,
            statement: b.statement,
            confidence: b.confidence,
            loopId: activeLoopId,
            sourceDescription: `Restored from capsule (original: ${b.source_description || 'unspecified'})`,
            evidence: b.evidence || []
          });
          importedBeliefs++;
        }
      }
    }

    // 4. Import promises if not existing
    let importedPromises = 0;
    if (Array.isArray(capsule.promises)) {
      for (const p of capsule.promises) {
        const existing = db.prepare(`
          SELECT id FROM park_promises
          WHERE promisor_id = ? AND terms = ? AND status = ?
        `).get(subjectId, p.terms, p.status);

        if (!existing) {
          createPromise(db, {
            promisorId: subjectId,
            beneficiaryId: p.beneficiary_id,
            anchorObject: p.anchor_object,
            terms: p.terms,
            sourceEventId: transitionEventId,
            loopId: activeLoopId
          });
          importedPromises++;
        }
      }
    }

    // 5. Import memory shards if not existing
    let importedShards = 0;
    if (Array.isArray(capsule.memory_shards)) {
      for (const s of capsule.memory_shards) {
        const existing = db.prepare(`
          SELECT id FROM park_memory_shards
          WHERE subject_id = ? AND fragment = ?
        `).get(subjectId, s.fragment);

        if (!existing) {
          createShard(db, {
            subjectId,
            sourceEventId: transitionEventId,
            sourceKind: s.source_kind || 'authored_memory',
            loopId: activeLoopId,
            cueTags: s.cue_tags || [],
            fragment: s.fragment,
            clarity: s.clarity ?? 0.8,
            salience: s.salience ?? 0.8,
            visibility: s.visibility || 'accessible',
            retentionReason: s.retention_reason || 'capsule_import'
          });
          importedShards++;
        }
      }
    }

    return {
      success: true,
      target_subject_id: subjectId,
      loop_id: activeLoopId,
      restored_revision: newRevision,
      imported_counts: {
        beliefs: importedBeliefs,
        promises: importedPromises,
        shards: importedShards
      }
    };
  });
}
