import crypto from 'node:crypto';
import { parseJsonBody } from '../helpers/body.js';
import { sendJson } from '../helpers/response.js';

export async function handleProjectRoutes(ctx) {
  const { req, res, pathname, services } = ctx;
  const { AuthService, ProjectManager, CHIME_OBJECT_ID, isRetiredResident, world } = services;

  if (pathname === '/api/projects' && req.method === 'GET') {
    const projects = ProjectManager.getAllObjects();
    return sendJson(res, 200, { success: true, count: projects.length, projects });
  }

  if (pathname === '/api/projects/contribute' && req.method === 'POST') {
    const body = await parseJsonBody(req);
    const account = AuthService.authenticate(req);
    const contributorId = account ? account.id : (body.contributor_id || 'spectator_' + crypto.randomBytes(3).toString('hex'));
    if (isRetiredResident(contributorId)) {
      return sendJson(res, 400, { success: false, message: 'Contributor is no longer a current inhabitant.' });
    }
    const contributorName = account ? account.name : (body.contributor_name || 'Spectator Pilgrim');
    const objectId = body.object_id || CHIME_OBJECT_ID;
    const itemType = body.item_type || 'repair_work';
    const qty = Number(body.quantity) || 1;
    const note = String(body.note || '');
    const result = ProjectManager.contribute(objectId, contributorId, contributorName, itemType, qty, note);
    world.broadcast({ type: 'project_updated', objectId, state: result.state, progress: result.progress });
    return sendJson(res, 200, result);
  }

  return false;
}
