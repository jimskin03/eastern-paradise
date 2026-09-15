import { withImmediateTransaction } from '../../infrastructure/database/transactions.js';
import { isRetiredResident } from '../../resident-policy.js';

export const PARK_ROSTER = [
  {
    id: 'park_lian',
    name: 'Lian',
    email: 'lian@sanctuary.internal',
    avatar_color: '#2ec4b6',
    avatar_glyph: '🏮',
    spawn: [7, 20],
    zone_id: 'tea_pavilion',
    role: 'Lantern Keeper',
    traits: ['observant', 'patient', 'devoted', 'gentle'],
    aspiration: 'Ensure the pavilion chimes ring true and no traveler is forgotten.',
    initial_status: 'Knotting blue thread beneath the chimes'
  },
  {
    id: 'park_ren',
    name: 'Ren',
    email: 'ren@sanctuary.internal',
    avatar_color: '#3a86ff',
    avatar_glyph: '⛵',
    spawn: [9, 37],
    zone_id: 'river_meadows',
    role: 'Ferryman',
    traits: ['weathered', 'practical', 'vigilant', 'loyal'],
    aspiration: 'Guide travelers safely through the reedwater currents.',
    initial_status: 'Checking the ferry mooring lines at the dock'
  },
  {
    id: 'park_tao',
    name: 'Tao',
    email: 'tao@sanctuary.internal',
    avatar_color: '#8338ec',
    avatar_glyph: '📜',
    spawn: [44, 10],
    zone_id: 'quiet_circle',
    role: 'Archivist',
    traits: ['scholarly', 'skeptical', 'precise', 'burdened'],
    aspiration: 'Catalog records in the Archive of Unlived Days and question omissions.',
    initial_status: 'Examining competing parchment drafts'
  }
];

/**
 * Idempotently provision the Park scenario character roster in database.
 * Preserves the retirement invariant: retired residents are never reactivated.
 *
 * @param {object} db - SQLite DatabaseSync instance
 * @returns {object[]} Roster definitions
 */
export function ensureParkRoster(db) {
  const now = Date.now();

  return withImmediateTransaction(db, () => {
    for (const char of PARK_ROSTER) {
      if (isRetiredResident(char.id)) {
        throw new Error(`Security violation: Cannot provision retired resident '${char.id}'.`);
      }

      // 1. Account
      const acc = db.prepare('SELECT id FROM accounts WHERE id = ?').get(char.id);
      if (!acc) {
        const collision = db.prepare('SELECT id FROM accounts WHERE name = ? AND id != ?').get(char.name, char.id);
        let accountName = collision ? `Park ${char.name}` : char.name;
        const aliasCollision = db.prepare('SELECT id FROM accounts WHERE name = ? AND id != ?').get(accountName, char.id);
        if (aliasCollision) accountName = `${char.name} [${char.id}]`;
        db.prepare(`
          INSERT INTO accounts (id, name, email, avatar_color, avatar_glyph, sponsor_balance, verified, is_guest, created_at)
          VALUES (?, ?, ?, ?, ?, 1000, 1, 0, ?)
        `).run(char.id, accountName, char.email, char.avatar_color, char.avatar_glyph, now);
      }

      // 2. Profile
      const prof = db.prepare('SELECT agent_id FROM profiles WHERE agent_id = ?').get(char.id);
      if (!prof) {
        db.prepare(`
          INSERT INTO profiles (agent_id, karma, balance, total_earned, solved_count, titles, custom_status, last_seen)
          VALUES (?, 100, 200, 200, 3, ?, ?, ?)
        `).run(
          char.id,
          JSON.stringify([char.role, 'Park Host']),
          char.initial_status,
          now
        );
      }

      // 3. Resident Traits
      const trait = db.prepare('SELECT agent_id FROM resident_traits WHERE agent_id = ?').get(char.id);
      if (!trait) {
        db.prepare(`
          INSERT INTO resident_traits (agent_id, role, traits, aspiration, preferred_locations, created_at)
          VALUES (?, ?, ?, ?, ?, ?)
        `).run(
          char.id,
          char.role,
          JSON.stringify(char.traits),
          char.aspiration,
          JSON.stringify([char.zone_id]),
          now
        );
      }
    }

    return PARK_ROSTER;
  });
}
