import { sendJson } from '../helpers/response.js';

function serializeResident(resident, services, memoryLimit) {
  const { db, SocialSystem } = services;
  const traits = db.prepare('SELECT * FROM resident_traits WHERE agent_id = ?').get(resident.id);
  return {
    id: resident.id,
    name: resident.name,
    role: resident.role,
    traits: traits ? JSON.parse(traits.traits || '[]') : resident.traits,
    aspiration: resident.aspiration,
    pos: resident.pos,
    zone: resident.zone_name,
    avatar_color: resident.avatar_color,
    avatar_glyph: resident.avatar_glyph,
    status: resident.status,
    public_intent: resident.public_intent,
    current_goal: resident.current_goal,
    needs: resident.needs,
    action_state: resident.action_state,
    relationships: SocialSystem.getRelationshipsForAgent(resident.id),
    memories: SocialSystem.getMemoriesForAgent(resident.id, memoryLimit)
  };
}

export async function handleResidentRoutes(ctx) {
  const { req, res, pathname, services } = ctx;
  const { residentManager } = services;

  if (pathname === '/api/residents' && req.method === 'GET') {
    const residents = residentManager.getAllResidents().map(r => serializeResident(r, services, 5));
    return sendJson(res, 200, { success: true, count: residents.length, residents });
  }

  if (pathname.startsWith('/api/residents/') && req.method === 'GET') {
    const id = pathname.replace('/api/residents/', '').trim();
    const resident = residentManager.getResident(id);
    if (!resident) return sendJson(res, 404, { success: false, message: 'Resident not found.' });
    return sendJson(res, 200, { success: true, resident: serializeResident(resident, services, 10) });
  }

  return false;
}
