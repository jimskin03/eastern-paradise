// Stable IDs from the original built-in cast. Keep their records for history,
// but never expose them as current inhabitants or allow them to re-enter.
export const RETIRED_RESIDENT_IDS = Object.freeze([
  'resident_mei', 'resident_lin', 'resident_jun'
]);

export const RETIRED_RESIDENT_SQL = "'resident_mei', 'resident_lin', 'resident_jun'";

export function isRetiredResident(agentId) {
  return RETIRED_RESIDENT_IDS.includes(agentId);
}

export function isNpcAgent(agentId) {
  if (!agentId || typeof agentId !== 'string') return false;
  return agentId.startsWith('resident_') || agentId.startsWith('npc_');
}

