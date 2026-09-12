import { sendJson } from '../helpers/response.js';

export async function handleResearchRoutes(ctx) {
  const { req, res, pathname, parsedUrl, services } = ctx;
  if (pathname !== '/api/research/summary' || req.method !== 'GET') return false;
  const days = parsedUrl.searchParams.get('days') || 30;
  return sendJson(res, 200, {
    success: true,
    research: services.ResearchTelemetry.getSummary(days)
  });
}
