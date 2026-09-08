export function handleCorsPreflight(req, res) {
  if (req.method !== 'OPTIONS') return false;

  res.writeHead(204, {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Agent-Key'
  });
  res.end();
  return true;
}
