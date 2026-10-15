import { createGzip } from 'node:zlib';
import { acceptsGzip } from './encoding.js';

export function sendJson(res, statusCode, data, extraHeaders = {}) {
  const body = JSON.stringify(data);
  const gzip = Buffer.byteLength(body) >= 1024 && acceptsGzip(res.req?.headers?.['accept-encoding']);
  res.writeHead(statusCode, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Agent-Key, Idempotency-Key',
    ...extraHeaders,
    Vary: [extraHeaders.Vary, 'Accept-Encoding'].filter(Boolean).join(', '),
    ...(gzip ? { 'Content-Encoding': 'gzip' } : {})
  });
  if (res.req?.method === 'HEAD') return res.end();
  if (!gzip) return res.end(body);
  const stream = createGzip();
  stream.on('error', err => res.destroy(err));
  res.on('close', () => stream.destroy());
  stream.pipe(res);
  stream.end(body);
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
