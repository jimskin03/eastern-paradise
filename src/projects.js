import { db } from './db.js';
import { eventLedger } from './events.js';
import { SocialSystem } from './social.js';

export const CHIME_OBJECT_ID = 'obj_chime_bamboo';

export class ProjectManager {
  static init() {
    const existing = db.prepare('SELECT * FROM world_objects WHERE id = ?').get(CHIME_OBJECT_ID);
    if (!existing) {
      const now = Date.now();
      const initialData = {
        name: 'Resonance Chimes of Bamboo Grove',
        materials_needed: {
          willow_ribbon: 1,
          copper_striker: 1,
          cedar_resin: 1
        },
        materials_collected: {
          willow_ribbon: 0,
          copper_striker: 0,
          cedar_resin: 0
        },
        repair_progress: 0, // 0 to 100
        repaired_style: 'standard', // or 'harmonious'
        last_toggled_at: null
      };

      db.prepare(`
        INSERT INTO world_objects (id, zone_id, pos_x, pos_y, object_type, state, visual_variant, contributors, data, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        CHIME_OBJECT_ID,
        'bamboo_grove',
        22,
        5,
        'resonance_chimes',
        'damaged',
        'weathered',
        '[]',
        JSON.stringify(initialData),
        now
      );

      // Record world event for world inception
      eventLedger.recordEvent({
        event_type: 'object_state_change',
        zone_id: 'bamboo_grove',
        description: 'The ancient Resonance Chimes hang silent and weathered in the Bamboo Grove, awaiting restoration.',
        payload: { object_id: CHIME_OBJECT_ID, state: 'damaged' }
      });
    }
  }

  static getObject(objectId = CHIME_OBJECT_ID) {
    const row = db.prepare('SELECT * FROM world_objects WHERE id = ?').get(objectId);
    if (!row) return null;
    return {
      ...row,
      contributors: JSON.parse(row.contributors || '[]'),
      data: JSON.parse(row.data || '{}')
    };
  }

  static getAllObjects() {
    const rows = db.prepare('SELECT * FROM world_objects').all();
    return rows.map(r => ({
      ...r,
      contributors: JSON.parse(r.contributors || '[]'),
      data: JSON.parse(r.data || '{}')
    }));
  }

  /**
   * Contribute materials or effort towards the project.
   */
  static contribute(objectId, contributorId, contributorName, itemType, quantity = 1, note = '') {
    const obj = this.getObject(objectId);
    if (!obj) throw new Error(`Object ${objectId} not found.`);

    const now = Date.now();
    const data = obj.data;
    const contributors = obj.contributors;

    if (!contributors.some(c => c.id === contributorId)) {
      contributors.push({ id: contributorId, name: contributorName, contributed_at: now });
    }

    let progressGained = 0;
    if (data.materials_collected && itemType in data.materials_collected) {
      data.materials_collected[itemType] = Math.min(
        data.materials_needed[itemType] || 1,
        (data.materials_collected[itemType] || 0) + quantity
      );
      progressGained = 30;
    } else if (itemType === 'repair_work') {
      progressGained = quantity * 20;
    } else if (itemType === 'merit') {
      progressGained = 15;
    }

    data.repair_progress = Math.min(100, (data.repair_progress || 0) + progressGained);

    // Check if ready to transition
    const allMaterials = Object.keys(data.materials_needed).every(
      k => (data.materials_collected[k] || 0) >= data.materials_needed[k]
    );

    let newState = obj.state;
    let newVariant = obj.visual_variant;

    if (obj.state === 'damaged' && (progressGained > 0 || allMaterials)) {
      newState = 'in_progress';
      newVariant = 'rebuilding';
    }

    if (data.repair_progress >= 100 && allMaterials) {
      newState = 'completed';
      newVariant = 'harmonious_radiant';
    }

    db.prepare(`
      UPDATE world_objects
      SET state = ?, visual_variant = ?, contributors = ?, data = ?, updated_at = ?
      WHERE id = ?
    `).run(
      newState,
      newVariant,
      JSON.stringify(contributors),
      JSON.stringify(data),
      now,
      objectId
    );

    const desc = `${contributorName} contributed ${itemType} to ${data.name}. (Progress: ${data.repair_progress}%)`;
    eventLedger.recordEvent({
      event_type: newState === 'completed' ? 'object_repaired' : 'project_contribution',
      actor_id: contributorId,
      actor_name: contributorName,
      zone_id: obj.zone_id,
      description: newState === 'completed' ? `The Resonance Chimes have been fully restored by ${contributorName} and the sanctuary community!` : desc,
      payload: {
        object_id: objectId,
        item: itemType,
        progress: data.repair_progress,
        state: newState,
        note
      }
    });

    return {
      success: true,
      state: newState,
      progress: data.repair_progress,
      materials: data.materials_collected,
      message: desc
    };
  }

  /**
   * Touch or ring the chime.
   */
  static ringChime(agentId, agentName) {
    const obj = this.getObject(CHIME_OBJECT_ID);
    if (!obj) return { success: false, message: 'Chime not found.' };

    const now = Date.now();
    obj.data.last_toggled_at = now;
    db.prepare('UPDATE world_objects SET data = ?, updated_at = ? WHERE id = ?')
      .run(JSON.stringify(obj.data), now, CHIME_OBJECT_ID);

    const isCompleted = obj.state === 'completed';
    const soundType = isCompleted ? 'resonant_pentatonic_harmonic' : 'dull_metallic_clank';
    const desc = isCompleted
      ? `${agentName} touched the restored Resonance Chimes. A pure pentatonic melody reverberated across Bamboo Whisper Grove.`
      : `${agentName} touched the cracked Resonance Chimes. A muffled, hollow clatter was heard.`;

    eventLedger.recordEvent({
      event_type: 'chime_ringing',
      actor_id: agentId,
      actor_name: agentName,
      zone_id: 'bamboo_grove',
      description: desc,
      payload: {
        sound: soundType,
        completed: isCompleted
      }
    });

    return {
      success: true,
      completed: isCompleted,
      sound: soundType,
      message: desc
    };
  }
}
