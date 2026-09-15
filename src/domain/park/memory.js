import crypto from 'node:crypto';

export const VALID_SOURCE_KINDS = new Set([
  'observed_event',
  'authored_memory',
  'false_memory',
  'relationship_trace',
  'promise_anchor',
  'inscription'
]);

export const VALID_VISIBILITIES = new Set([
  'accessible',
  'suppressed',
  'recovered',
  'destroyed'
]);

/**
 * Create a new memory shard.
 *
 * @param {object} db - SQLite DatabaseSync instance
 * @param {object} params
 * @param {string} params.subjectId
 * @param {string} [params.sourceEventId]
 * @param {string} [params.sourceKind='observed_event']
 * @param {string} params.loopId
 * @param {string[]} [params.cueTags=[]]
 * @param {string} params.fragment
 * @param {number} [params.clarity=0.5]
 * @param {number} [params.salience=0.5]
 * @param {string} [params.visibility='accessible']
 * @param {string} [params.retentionReason]
 * @returns {object} The created shard record
 */
export function createShard(db, {
  subjectId,
  sourceEventId = null,
  sourceKind = 'observed_event',
  loopId,
  cueTags = [],
  fragment,
  clarity = 0.5,
  salience = 0.5,
  visibility = 'accessible',
  retentionReason = null
} = {}) {
  if (!subjectId || !loopId || !fragment) {
    throw new Error('subjectId, loopId, and fragment are required to create a memory shard.');
  }

  if (!VALID_SOURCE_KINDS.has(sourceKind)) {
    throw new Error(`Invalid sourceKind: '${sourceKind}'. Must be one of: ${Array.from(VALID_SOURCE_KINDS).join(', ')}`);
  }

  if (!VALID_VISIBILITIES.has(visibility)) {
    throw new Error(`Invalid visibility: '${visibility}'. Must be one of: ${Array.from(VALID_VISIBILITIES).join(', ')}`);
  }

  const clampedClarity = Math.max(0, Math.min(1, Number(clarity) || 0));
  const clampedSalience = Math.max(0, Math.min(1, Number(salience) || 0));
  const tags = Array.isArray(cueTags) ? cueTags : [];
  const now = Date.now();
  const id = `shard_${now}_${crypto.randomBytes(3).toString('hex')}`;

  db.prepare(`
    INSERT INTO park_memory_shards (
      id, subject_id, source_event_id, source_kind, loop_id,
      cue_tags, fragment, clarity, salience, visibility, retention_reason, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    subjectId,
    sourceEventId,
    sourceKind,
    loopId,
    JSON.stringify(tags),
    fragment,
    clampedClarity,
    clampedSalience,
    visibility,
    retentionReason,
    now
  );

  const row = db.prepare('SELECT * FROM park_memory_shards WHERE id = ?').get(id);
  return {
    ...row,
    cue_tags: JSON.parse(row.cue_tags || '[]')
  };
}

/**
 * Retrieve memory shards for a subject bounded by cue tags and salience.
 * Only 'accessible' and 'recovered' shards are returned.
 * Suppressed or destroyed shards are excluded.
 *
 * @param {object} db - SQLite DatabaseSync instance
 * @param {object} params
 * @param {string} params.subjectId
 * @param {string[]} [params.cueTags=[]]
 * @param {string} [params.loopId]
 * @param {number} [params.limit=5]
 * @returns {object[]} Bounded list of matching shards
 */
export function retrieveShards(db, {
  subjectId,
  cueTags = [],
  loopId = null,
  limit = 5
} = {}) {
  if (!subjectId) {
    throw new Error('subjectId is required to retrieve shards.');
  }

  const lim = Math.max(1, Math.min(50, Number(limit) || 5));
  const tags = Array.isArray(cueTags) ? cueTags.filter(Boolean) : [];

  let rows = [];

  if (tags.length > 0) {
    const placeholders = tags.map(() => '?').join(',');
    let sql = `
      SELECT s.*, COUNT(DISTINCT tag.value) AS matched_cues
      FROM park_memory_shards s, json_each(s.cue_tags) AS tag
      WHERE s.subject_id = ?
        AND s.visibility IN ('accessible', 'recovered')
        AND tag.value IN (${placeholders})
    `;
    const params = [subjectId, ...tags];

    if (loopId) {
      sql += ' AND s.loop_id = ?';
      params.push(loopId);
    }

    sql += `
      GROUP BY s.id
      ORDER BY matched_cues DESC, s.salience DESC, s.created_at DESC
      LIMIT ?
    `;
    params.push(lim);

    rows = db.prepare(sql).all(...params);
  } else {
    let sql = `
      SELECT s.*, 0 AS matched_cues
      FROM park_memory_shards s
      WHERE s.subject_id = ?
        AND s.visibility IN ('accessible', 'recovered')
    `;
    const params = [subjectId];

    if (loopId) {
      sql += ' AND s.loop_id = ?';
      params.push(loopId);
    }

    sql += ' ORDER BY s.salience DESC, s.created_at DESC LIMIT ?';
    params.push(lim);

    rows = db.prepare(sql).all(...params);
  }

  return rows.map(r => ({
    ...r,
    cue_tags: JSON.parse(r.cue_tags || '[]')
  }));
}

/**
 * Get all shards for a given subject and loop (used for debugging/admin).
 */
export function getShardsByLoop(db, { subjectId, loopId }) {
  const rows = db.prepare(`
    SELECT * FROM park_memory_shards
    WHERE subject_id = ? AND loop_id = ?
    ORDER BY created_at ASC
  `).all(subjectId, loopId);

  return rows.map(r => ({
    ...r,
    cue_tags: JSON.parse(r.cue_tags || '[]')
  }));
}

/**
 * Batch-suppress accessible shards in a loop, exempting retained shard IDs.
 */
export function suppressShards(db, { loopId, retainedShardIds = [] } = {}) {
  if (Array.isArray(retainedShardIds) && retainedShardIds.length > 0) {
    const placeholders = retainedShardIds.map(() => '?').join(',');
    return db.prepare(`
      UPDATE park_memory_shards
      SET visibility = 'suppressed'
      WHERE loop_id = ? AND visibility = 'accessible' AND id NOT IN (${placeholders})
    `).run(loopId, ...retainedShardIds);
  }

  return db.prepare(`
    UPDATE park_memory_shards
    SET visibility = 'suppressed'
    WHERE loop_id = ? AND visibility = 'accessible'
  `).run(loopId);
}

/**
 * Recover a suppressed shard so it becomes accessible to character perception again.
 */
export function recoverShard(db, shardId) {
  const shard = db.prepare('SELECT * FROM park_memory_shards WHERE id = ?').get(shardId);
  if (!shard) {
    throw new Error(`Shard ${shardId} not found.`);
  }

  db.prepare(`
    UPDATE park_memory_shards
    SET visibility = 'recovered'
    WHERE id = ? AND visibility = 'suppressed'
  `).run(shardId);

  const updated = db.prepare('SELECT * FROM park_memory_shards WHERE id = ?').get(shardId);
  return {
    ...updated,
    cue_tags: JSON.parse(updated.cue_tags || '[]')
  };
}

/**
 * Get retained shards that survived a reset by retention reason.
 */
export function getRetainedShards(db, { subjectId, loopId = null, retentionReasons = [] } = {}) {
  let sql = 'SELECT * FROM park_memory_shards WHERE subject_id = ? AND retention_reason IS NOT NULL';
  const params = [subjectId];

  if (loopId) {
    sql += ' AND loop_id = ?';
    params.push(loopId);
  }

  if (Array.isArray(retentionReasons) && retentionReasons.length > 0) {
    const placeholders = retentionReasons.map(() => '?').join(',');
    sql += ` AND retention_reason IN (${placeholders})`;
    params.push(...retentionReasons);
  }

  sql += ' ORDER BY created_at DESC';
  const rows = db.prepare(sql).all(...params);

  return rows.map(r => ({
    ...r,
    cue_tags: JSON.parse(r.cue_tags || '[]')
  }));
}

/**
 * Total count of shards for a subject (for bounding and cap enforcement).
 */
export function countShardsBySubject(db, subjectId) {
  const row = db.prepare('SELECT COUNT(*) AS count FROM park_memory_shards WHERE subject_id = ?').get(subjectId);
  return row ? row.count : 0;
}
