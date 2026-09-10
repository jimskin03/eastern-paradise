import { parseJsonBody } from '../helpers/body.js';
import { sendJson } from '../helpers/response.js';

const unauthorized = res => sendJson(res, 401, {
  success: false,
  error: 'unauthorized',
  message: 'Unauthorized. Provide valid Authorization: Bearer <api_key> header.'
});

const sendRouteError = (res, error) => sendJson(res, error.status || 400, {
  success: false,
  error: String(error.code || 'bad_request').toLowerCase(),
  error_code: error.code || 'BAD_REQUEST',
  message: error.message || 'Request failed.'
});

const queryPage = parsedUrl => ({
  limit: parsedUrl.searchParams.get('limit'),
  offset: parsedUrl.searchParams.get('offset')
});

export async function handleHypothesisRoutes(ctx) {
  const { req, res, pathname, parsedUrl, services } = ctx;
  const { AuthService, Hypotheses } = services;
  if (!pathname.startsWith('/api/hypotheses')) return false;

  if (pathname === '/api/hypotheses/public' && req.method === 'GET') {
    return sendJson(res, 200, { success: true, ...Hypotheses.listPublic(queryPage(parsedUrl)) });
  }

  const account = AuthService.authenticate(req);
  if (!account) {
    const publicDetail = pathname.match(/^\/api\/hypotheses\/([^/]+)$/);
    if (publicDetail && req.method === 'GET') {
      try {
        return sendJson(res, 200, { success: true, hypothesis: Hypotheses.getById(decodeURIComponent(publicDetail[1])) });
      } catch (error) {
        return sendRouteError(res, error);
      }
    }
    return unauthorized(res);
  }

  if (pathname === '/api/hypotheses' && req.method === 'POST') {
    try {
      const body = await parseJsonBody(req);
      const result = Hypotheses.create({
        agent: account,
        statement: body.statement,
        confidence: body.confidence,
        visibility: body.visibility,
        evidence: body.evidence,
        requestId: body.request_id
      });
      return sendJson(res, result.idempotent ? 200 : 201, { success: true, ...result });
    } catch (error) {
      return sendRouteError(res, error);
    }
  }

  if (pathname === '/api/hypotheses/me' && req.method === 'GET') {
    return sendJson(res, 200, { success: true, ...Hypotheses.listMine(account.id, queryPage(parsedUrl)) });
  }

  const actionMatch = pathname.match(/^\/api\/hypotheses\/([^/]+)\/(evidence|revise|withdraw)$/);
  if (actionMatch && req.method === 'POST') {
    try {
      const hypothesisId = decodeURIComponent(actionMatch[1]);
      const action = actionMatch[2];
      const body = await parseJsonBody(req);
      let result;
      if (action === 'evidence') {
        result = Hypotheses.attachEvidence({
          agent: account,
          hypothesisId,
          evidenceId: body.evidence_id,
          relation: body.relation
        });
      } else if (action === 'revise') {
        result = Hypotheses.revise({
          agent: account,
          hypothesisId,
          statement: body.statement,
          confidence: body.confidence,
          reason: body.reason,
          evidenceId: body.evidence_id,
          relation: body.relation,
          requestId: body.request_id
        });
      } else {
        result = Hypotheses.withdraw({ agent: account, hypothesisId });
      }
      return sendJson(res, 200, { success: true, ...result });
    } catch (error) {
      return sendRouteError(res, error);
    }
  }

  const detailMatch = pathname.match(/^\/api\/hypotheses\/([^/]+)$/);
  if (detailMatch && req.method === 'GET') {
    try {
      return sendJson(res, 200, {
        success: true,
        hypothesis: Hypotheses.getById(decodeURIComponent(detailMatch[1]), account.id)
      });
    } catch (error) {
      return sendRouteError(res, error);
    }
  }

  return false;
}

