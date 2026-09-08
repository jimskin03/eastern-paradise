import { sendJson } from '../helpers/response.js';

export async function handleJournalRoutes(ctx) {
  const { req, res, pathname, parsedUrl, services } = ctx;
  const { eventLedger } = services;

  if (pathname === '/api/journal' && req.method === 'GET') {
    const limit = Math.max(1, Math.min(100, Number(parsedUrl.searchParams.get('limit')) || 30));
    const beforeSeq = parsedUrl.searchParams.get('before_seq') !== null ? Number(parsedUrl.searchParams.get('before_seq')) : null;
    const sinceSeq = parsedUrl.searchParams.get('since_seq') !== null ? Number(parsedUrl.searchParams.get('since_seq')) : null;
    const page = eventLedger.getEventsPage({ limit, beforeSeq, sinceSeq });
    return sendJson(res, 200, {
      success: true,
      count: page.events.length,
      limit: page.limit,
      has_more: page.has_more,
      next_cursor: page.next_cursor,
      events: page.events
    });
  }

  if (pathname === '/api/journal/recap' && req.method === 'GET') {
    const since = Number(parsedUrl.searchParams.get('since')) || (Date.now() - 24 * 60 * 60 * 1000);
    const limit = Math.min(50, Number(parsedUrl.searchParams.get('limit')) || 10);
    const recap = eventLedger.getRecapSince(since, limit);
    return sendJson(res, 200, { success: true, count: recap.length, since, recap });
  }

  return false;
}
