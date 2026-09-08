const WIPE_QUERIES = [
  "DELETE FROM interaction_logs WHERE agent_id != 'resident_ailicia'",
  "DELETE FROM world_events WHERE (actor_id IS NULL OR actor_id != 'resident_ailicia') AND (target_id IS NULL OR target_id != 'resident_ailicia')",
  "DELETE FROM spectator_messages WHERE target_agent_id != 'resident_ailicia'",
  "DELETE FROM board_messages WHERE agent_id != 'resident_ailicia'",
  "DELETE FROM agent_memories WHERE agent_id != 'resident_ailicia'",
  "DELETE FROM transactions WHERE (sender_id IS NULL OR sender_id != 'resident_ailicia') AND (recipient_id IS NULL OR recipient_id != 'resident_ailicia')",
  "DELETE FROM agent_promises WHERE from_agent != 'resident_ailicia' AND to_agent != 'resident_ailicia'",
  "DELETE FROM relationships WHERE agent_id != 'resident_ailicia' AND target_id != 'resident_ailicia'"
];

const COUNT_TABLES = [
  'board_messages', 'transactions', 'interaction_logs', 'spectator_messages',
  'relationships', 'agent_memories', 'agent_promises', 'world_events'
];

export async function wipeNonAiliciaLogs({ db, cloudClient }) {
  const localChanges = {};
  for (const query of WIPE_QUERIES) {
    const info = db.prepare(query).run();
    localChanges[query] = info.changes;
  }

  const cloudChanges = {};
  if (cloudClient) {
    for (const query of WIPE_QUERIES) {
      try {
        const res = await cloudClient.execute(query);
        cloudChanges[query] = res.affectedRowCount ?? res.rowsAffected ?? 0;
      } catch (err) {
        cloudChanges[query] = `Error: ${err.message}`;
      }
    }
  }

  const remaining = {};
  for (const table of COUNT_TABLES) {
    const row = db.prepare(`SELECT count(*) as cnt FROM ${table}`).get();
    remaining[table] = row.cnt;
  }

  return { localChanges, cloudChanges, remaining };
}
