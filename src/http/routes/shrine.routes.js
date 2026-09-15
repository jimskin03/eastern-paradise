import { parseJsonBody } from '../helpers/body.js';
import { sendApiError, sendJson } from '../helpers/response.js';
import {
  SHRINE_CHALLENGE_ID,
  SHRINE_MANIFEST
} from '../../domain/shrine/ritual.js';
import {
  admitAttempt,
  submitRitual,
  withdrawAttempt
} from '../../domain/shrine/attempts.js';
import {
  getMemorialInscriptions,
  getReceipt,
  recoverGuestSubject
} from '../../domain/shrine/memorial.js';
import { confirmShrineDurability } from '../../domain/shrine/durability.js';

function findUnknownFields(body, allowed) {
  return Object.keys(body || {}).filter(key => !allowed.has(key));
}

function mutationErrorStatus(err) {
  return err?.code === 'FORBIDDEN' ? 403 : 400;
}

export async function handleShrineRoutes(ctx) {
  const { req, res, pathname, parsedUrl, services } = ctx;
  const { AuthService } = services;

  // 1. GET /api/shrine/challenges/:id
  const challengeMatch = pathname.match(/^\/api\/shrine\/challenges\/([^/]+)$/);
  if (challengeMatch && req.method === 'GET') {
    const challengeId = decodeURIComponent(challengeMatch[1]);
    if (challengeId !== SHRINE_CHALLENGE_ID && challengeId !== 'current') {
      return sendApiError(res, 404, 'CHALLENGE_NOT_FOUND', `Shrine challenge '${challengeId}' not found.`);
    }

    return sendJson(res, 200, {
      success: true,
      challenge: SHRINE_MANIFEST
    });
  }

  // 2. POST /api/shrine/challenges/:id/attempts (Admission)
  const admitMatch = pathname.match(/^\/api\/shrine\/challenges\/([^/]+)\/attempts$/);
  if (admitMatch && req.method === 'POST') {
    const challengeId = decodeURIComponent(admitMatch[1]);
    if (challengeId !== SHRINE_CHALLENGE_ID && challengeId !== 'current') {
      return sendApiError(res, 404, 'CHALLENGE_NOT_FOUND', `Shrine challenge '${challengeId}' not found.`);
    }

    const account = AuthService.authenticate(req);
    if (!account) {
      return sendApiError(
        res,
        401,
        'UNAUTHORIZED',
        'Authentication required to enter the Shrine of Unfinished Names.',
        'Obtain a guest or verified session (POST /api/auth/guest or POST /api/auth/register) and pass Authorization: Bearer <token>.'
      );
    }

    const body = await parseJsonBody(req);
    const unknown = findUnknownFields(body, new Set(['alias', 'idempotency_key', 'offering']));
    if (unknown.length > 0) {
      return sendApiError(res, 400, 'UNKNOWN_FIELDS', `Unknown admission field(s): ${unknown.join(', ')}.`);
    }
    const idempotencyKey = body.idempotency_key || req.headers['idempotency-key'];
    if (!idempotencyKey) {
      return sendApiError(
        res,
        400,
        'IDEMPOTENCY_KEY_REQUIRED',
        'An idempotency_key is required for admission to the memorial.',
        'Provide a unique idempotency_key in the request body or Idempotency-Key header.'
      );
    }

    try {
      const isGuest = Boolean(account.is_guest === 1 || String(account.id).startsWith('guest_'));
      const result = admitAttempt({
        actorId: account.id,
        alias: body.alias || account.name,
        isGuest,
        challengeId: SHRINE_CHALLENGE_ID,
        idempotencyKey: String(idempotencyKey),
        offering: body.offering || {}
      });

      await confirmShrineDurability(services?.CloudStorage);

      return sendJson(res, result.idempotent_replay ? 200 : 201, {
        success: true,
        attempt: result.attempt,
        receipt_token: result.receipt_token,
        recovery_secret: result.recovery_secret,
        idempotent_replay: result.idempotent_replay,
        message: 'Admitted to the Shrine of Unfinished Names. Your name is inscribed.'
      });
    } catch (err) {
      if (err?.code === 'DURABILITY_UNAVAILABLE') {
        return sendApiError(res, 503, 'DURABILITY_UNAVAILABLE', 'Admission was not acknowledged because durable cloud persistence could not be confirmed. Retry with the same idempotency key.');
      }
      return sendApiError(res, 400, 'ADMISSION_ERROR', err.message);
    }
  }

  // 3. POST /api/shrine/attempts/:id/submissions (Ritual submission)
  const submitMatch = pathname.match(/^\/api\/shrine\/attempts\/([^/]+)\/submissions$/);
  if (submitMatch && req.method === 'POST') {
    const attemptId = decodeURIComponent(submitMatch[1]);
    const account = AuthService.authenticate(req);
    if (!account) {
      return sendApiError(res, 401, 'UNAUTHORIZED', 'Authentication required to submit ritual attempt.');
    }

    const body = await parseJsonBody(req);
    const unknown = findUnknownFields(body, new Set(['approach_type', 'seal_input', 'insight_text', 'contribution_text']));
    if (unknown.length > 0) {
      return sendApiError(res, 400, 'UNKNOWN_FIELDS', `Unknown ritual field(s): ${unknown.join(', ')}.`);
    }
    try {
      const result = submitRitual({
        attemptId,
        actorId: account.id,
        approachType: body.approach_type,
        sealInput: body.seal_input,
        insightText: body.insight_text,
        contributionText: body.contribution_text
      });

      await confirmShrineDurability(services?.CloudStorage);

      return sendJson(res, 200, {
        success: true,
        attempt: result.attempt,
        gate_state: result.gate_state,
        outcome: result.outcome,
        message: result.message,
        seal_evaluation: result.seal_evaluation,
        insight_evaluation: result.insight_evaluation
      });
    } catch (err) {
      if (err?.code === 'DURABILITY_UNAVAILABLE') {
        return sendApiError(res, 503, 'DURABILITY_UNAVAILABLE', 'Ritual completion was not acknowledged because durable cloud persistence could not be confirmed. Retry the request.');
      }
      return sendApiError(res, mutationErrorStatus(err), err?.code === 'FORBIDDEN' ? 'FORBIDDEN' : 'SUBMISSION_ERROR', err.message);
    }
  }

  // 4. POST /api/shrine/attempts/:id/withdraw
  const withdrawMatch = pathname.match(/^\/api\/shrine\/attempts\/([^/]+)\/withdraw$/);
  if (withdrawMatch && req.method === 'POST') {
    const attemptId = decodeURIComponent(withdrawMatch[1]);
    const account = AuthService.authenticate(req);
    if (!account) {
      return sendApiError(res, 401, 'UNAUTHORIZED', 'Authentication required to withdraw from attempt.');
    }

    const body = await parseJsonBody(req);
    const unknown = findUnknownFields(body, new Set(['reason']));
    if (unknown.length > 0) {
      return sendApiError(res, 400, 'UNKNOWN_FIELDS', `Unknown withdrawal field(s): ${unknown.join(', ')}.`);
    }
    try {
      const result = withdrawAttempt({
        attemptId,
        actorId: account.id,
        reason: body.reason || 'Withdrew from trial'
      });

      await confirmShrineDurability(services?.CloudStorage);

      return sendJson(res, 200, {
        success: true,
        attempt: result.attempt,
        gate_state: result.gate_state,
        outcome: result.outcome,
        message: result.message
      });
    } catch (err) {
      if (err?.code === 'DURABILITY_UNAVAILABLE') {
        return sendApiError(res, 503, 'DURABILITY_UNAVAILABLE', 'Withdrawal was not acknowledged because durable cloud persistence could not be confirmed. Retry the request.');
      }
      return sendApiError(res, mutationErrorStatus(err), err?.code === 'FORBIDDEN' ? 'FORBIDDEN' : 'WITHDRAW_ERROR', err.message);
    }
  }

  // 5. GET /api/shrine/memorial (Public Tomb records)
  if ((pathname === '/api/shrine/memorial' || pathname === '/api/shrine/memorial/inscriptions') && req.method === 'GET') {
    const limit = parsedUrl.searchParams.get('limit');
    const cursor = parsedUrl.searchParams.get('cursor');
    const assurance = parsedUrl.searchParams.get('assurance');

    const result = getMemorialInscriptions({ limit, cursor, assurance });
    return sendJson(res, 200, {
      success: true,
      ...result
    });
  }

  // 6. GET /api/shrine/attempts/:id/receipt
  const receiptMatch = pathname.match(/^\/api\/shrine\/attempts\/([^/]+)\/receipt$/);
  if (receiptMatch && req.method === 'GET') {
    const target = decodeURIComponent(receiptMatch[1]);
    const receipt = getReceipt(target);
    if (!receipt) {
      return sendApiError(res, 404, 'RECEIPT_NOT_FOUND', `Receipt '${target}' not found.`);
    }

    return sendJson(res, 200, {
      success: true,
      receipt
    });
  }

  // 7. POST /api/shrine/subjects/recover
  if (pathname === '/api/shrine/subjects/recover' && req.method === 'POST') {
    const account = AuthService.authenticate(req);
    if (!account) {
      return sendApiError(res, 401, 'UNAUTHORIZED', 'An active guest session is required to recover memorial control.');
    }
    if (!(account.is_guest === 1 || String(account.id).startsWith('guest_'))) {
      return sendApiError(res, 403, 'FORBIDDEN', 'Guest memorial recovery can only be attached to a guest session.');
    }

    const body = await parseJsonBody(req);
    const unknown = findUnknownFields(body, new Set(['recovery_secret']));
    if (unknown.length > 0) {
      return sendApiError(res, 400, 'UNKNOWN_FIELDS', `Unknown recovery field(s): ${unknown.join(', ')}.`);
    }
    const recoverySecret = body.recovery_secret;
    if (!recoverySecret) {
      return sendApiError(res, 400, 'SECRET_REQUIRED', 'recovery_secret is required.');
    }

    const result = recoverGuestSubject({ recoverySecret, actorId: account.id });
    if (!result) {
      return sendApiError(res, 401, 'INVALID_SECRET', 'Invalid or unrecognized recovery secret.');
    }

    try {
      await confirmShrineDurability(services?.CloudStorage);
    } catch (_) {
      return sendApiError(res, 503, 'DURABILITY_UNAVAILABLE', 'Recovery was not acknowledged because durable cloud persistence could not be confirmed. Retry with the same recovery secret.');
    }

    return sendJson(res, 200, {
      success: true,
      recovery: result
    });
  }

  return false;
}
