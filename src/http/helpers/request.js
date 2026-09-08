export function getClientIp(req) {
  return req.headers['x-forwarded-for']?.split(',')[0].trim() || req.socket?.remoteAddress || '127.0.0.1';
}

export function getForwardedHost(req) {
  return req.headers['x-forwarded-host'] || req.headers.host || 'localhost:3000';
}

export function getForwardedBaseUrl(req) {
  const host = getForwardedHost(req);
  const proto = req.headers['x-forwarded-proto'] || 'http';
  return `${String(proto).split(',')[0].trim()}://${host}`;
}
