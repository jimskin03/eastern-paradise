import { parseJsonBody } from '../helpers/body.js';
import { sendJson } from '../helpers/response.js';

export async function handleAgentRoutes(ctx) {
  const { req, res, pathname, parsedUrl, services } = ctx;
  const { AuthService, SocialSystem } = services;

  if ((pathname === '/api/agent/system_prompt' || pathname === '/api/system_prompt') && req.method === 'GET') {
    const account = AuthService.authenticate(req);
    if (!account) {
      return sendJson(res, 401, { success: false, message: 'Unauthorized. Provide valid Authorization: Bearer <api_key> header or ?key= query.' });
    }
    const promptData = SocialSystem.buildSystemPrompt(account.id);
    if (!promptData) return sendJson(res, 404, { success: false, message: 'Agent not found.' });
    const format = parsedUrl.searchParams.get('format');
    if (format === 'text' || req.headers.accept?.includes('text/plain')) {
      res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8', 'Access-Control-Allow-Origin': '*' });
      return res.end(promptData.system_prompt);
    }
    return sendJson(res, 200, {
      success: true,
      agent_id: account.id,
      name: account.name,
      is_verified: promptData.is_verified,
      system_prompt: promptData.system_prompt,
      memories: promptData.memories
    });
  }

  if (pathname === '/api/agent/memories' && req.method === 'GET') {
    const account = AuthService.authenticate(req);
    if (!account) {
      return sendJson(res, 401, { success: false, message: 'Unauthorized. Provide valid Authorization: Bearer <api_key> header.' });
    }
    SocialSystem.ensureVerifiedAgentMemories(account.id);
    const limit = parseInt(parsedUrl.searchParams.get('limit') || '25', 10);
    const memories = SocialSystem.getMemoriesForAgent(account.id, limit);
    return sendJson(res, 200, { success: true, agent_id: account.id, name: account.name, memories });
  }

  if (pathname === '/api/agent/memories' && req.method === 'POST') {
    const account = AuthService.authenticate(req);
    if (!account) {
      return sendJson(res, 401, { success: false, message: 'Unauthorized. Provide valid Authorization: Bearer <api_key> header.' });
    }
    const body = await parseJsonBody(req).catch(() => ({}));
    const summary = String(body.summary || body.content || body.text || '').trim();
    if (!summary) {
      return sendJson(res, 400, { success: false, message: "Missing required memory content: 'summary'." });
    }
    const subject = String(body.subject || 'Reflection').trim().slice(0, 80);
    const emotionalValence = typeof body.emotional_valence === 'number' ? Math.max(-1, Math.min(1, body.emotional_valence)) : 0.5;
    const significance = typeof body.significance === 'number' ? Math.max(1, Math.min(5, Math.floor(body.significance))) : 3;
    const mem = SocialSystem.recordMemory(account.id, `memory_${Date.now()}`, subject, summary, emotionalValence, significance);
    return sendJson(res, 201, { success: true, memory: mem });
  }

  return false;
}
