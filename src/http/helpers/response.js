export function sendJson(res, statusCode, data, extraHeaders = {}) {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Agent-Key',
    ...extraHeaders
  });
  res.end(JSON.stringify(data, null, 2));
}

export function sendApiError(res, statusCode, errorCode, message, suggestedAction, extra = {}, extraHeaders = {}) {
  return sendJson(res, statusCode, {
    success: false,
    error: errorCode.toLowerCase(),
    error_code: errorCode,
    message,
    suggested_action: suggestedAction,
    ...extra
  }, extraHeaders);
}
