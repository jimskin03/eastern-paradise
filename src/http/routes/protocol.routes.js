import { sendJson } from '../helpers/response.js';
import { getForwardedBaseUrl, getForwardedHost } from '../helpers/request.js';

export async function handleProtocolRoutes(ctx) {
  const { req, res, pathname, parsedUrl, services } = ctx;
  const { world, buildOpenApiSpec, buildManifest, buildInstructionsMarkdown, getHomepagePrompts } = services;

  if (pathname === '/openapi.json' && req.method === 'GET') {
    return sendJson(res, 200, buildOpenApiSpec(getForwardedBaseUrl(req)));
  }

  if (pathname === '/instructions' || pathname === '/api/instructions') {
    const instructions = buildInstructionsMarkdown(getForwardedHost(req));
    if (req.headers.accept?.includes('application/json') && pathname === '/api/instructions') {
      return sendJson(res, 200, {
        title: "Eastern Paradise Agent Instructions",
        markdown: instructions
      });
    }
    res.writeHead(200, { 'Content-Type': 'text/markdown; charset=utf-8' });
    return res.end(instructions);
  }

  if (pathname === '/api/protocol/prompts' && req.method === 'GET') {
    return sendJson(res, 200, {
      success: true,
      prompts: getHomepagePrompts(getForwardedBaseUrl(req))
    });
  }

  if (pathname === '/api/manifest' && req.method === 'GET') {
    const obelisks = world.getAllNodes()
      .filter(n => n.type === 'puzzle_node')
      .map(n => ({
        id: n.id,
        name: n.name,
        category: n.category,
        pos: n.pos,
        zone_id: n.zone_id,
        zone_name: n.zone_name
      }));
    return sendJson(res, 200, buildManifest(world, obelisks));
  }

  if (pathname === '/api/map' && req.method === 'GET') {
    return sendJson(res, 200, {
      sanctuary: "Eastern Paradise",
      version: "2.0.0",
      dimensions: { width: world.width, height: world.height },
      zones: world.zones.map(z => ({
        id: z.id,
        name: z.name,
        subtitle: z.subtitle,
        bounds: z.bounds,
        spawnPoint: z.spawnPoint,
        nodes: z.nodes
      })),
      nodes: world.getAllNodes()
    });
  }

  if ((pathname === '/api/world/nodes' || pathname === '/api/nodes') && req.method === 'GET') {
    const allNodes = world.getAllNodes();
    const categoryFilter = parsedUrl.searchParams.get('category');
    const typeFilter = parsedUrl.searchParams.get('type');
    const zoneFilter = parsedUrl.searchParams.get('zone');
    let filtered = allNodes;
    if (categoryFilter) {
      filtered = filtered.filter(n => n.category && n.category.toLowerCase() === categoryFilter.toLowerCase());
    }
    if (typeFilter) {
      filtered = filtered.filter(n => n.type && n.type.toLowerCase() === typeFilter.toLowerCase());
    }
    if (zoneFilter) {
      const matchedZone = world.getZone(zoneFilter);
      if (matchedZone) {
        filtered = filtered.filter(n => n.zone_id === matchedZone.id);
      }
    }
    return sendJson(res, 200, { total: filtered.length, nodes: filtered });
  }

  return false;
}
