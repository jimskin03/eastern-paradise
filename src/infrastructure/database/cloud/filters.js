export function shouldRetainCloudRow(table, row) {
  if (table === 'guest_top_scores') return true;
  if (table === 'board_messages' && (row.is_unverified === 1 || row.is_unverified === true)) return true;

  if (row.is_guest === 1 || row.is_guest === true) return false;
  if (row.agent_id && String(row.agent_id).startsWith('guest_')) return false;
  if (row.sender_id && String(row.sender_id).startsWith('guest_')) return false;
  if (row.recipient_id && String(row.recipient_id).startsWith('guest_')) return false;
  if (row.target_agent_id && String(row.target_agent_id).startsWith('guest_')) return false;

  return true;
}
