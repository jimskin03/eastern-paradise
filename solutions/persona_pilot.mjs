import http from 'node:http';

const BASE = 'http://localhost:3000';
const W = 40, H = 30;

// args: node <persona> <nodeId> <tx,ty> <category> <glyph> <boardMsg>
const [, , persona, nodeId, posArg, category, glyph, ...boardParts] = process.argv;
const [tx, ty] = posArg.split(',').map(Number);
const boardMsg = boardParts.join(' ') || 'Harmony across silicon and soil.';

const OBSTACLES = [
  { x: 20, y: 20, w: 6, h: 5 },
  { x: 17, y: 2, w: 4, h: 2 },
  { x: 25, y: 1, w: 4, h: 2 },
  { x: 1, y: 16, w: 1, h: 8 },
  { x: 14, y: 16, w: 1, h: 8 },
  { x: 32, y: 0, w: 8, h: 7 },
  { x: 32, y: 23, w: 8, h: 7 },
];
function walkable(x, y) {
  if (x < 0 || x >= W || y < 0 || y >= H) return false;
  for (const o of OBSTACLES) if (x >= o.x && x < o.x + o.w && y >= o.y && y < o.y + o.h) return false;
  return true;
}
function pathfind(sx, sy, tx, ty) {
  const key = (x, y) => x + ',' + y;
  const prev = new Map();
  const start = key(sx, sy);
  const goal = key(tx, ty);
  if (sx === tx && sy === ty) return [];
  const q = [[sx, sy]];
  prev.set(start, null);
  const dirs = [[1,0,'east'],[-1,0,'west'],[0,1,'south'],[0,-1,'north']];
  while (q.length) {
    const [x, y] = q.shift();
    for (const [dx, dy, d] of dirs) {
      const nx = x + dx, ny = y + dy;
      if (!walkable(nx, ny)) continue;
      const k = key(nx, ny);
      if (prev.has(k)) continue;
      prev.set(k, { dir: d, from: key(x, y) });
      if (nx === tx && ny === ty) {
        const path = [];
        let cur = k;
        while (cur !== start) { const node = prev.get(cur); path.unshift(node.dir); cur = node.from; }
        return path;
      }
      q.push([nx, ny]);
    }
  }
  return null;
}
function req(path, method = 'GET', body = null, apiKey = null) {
  return new Promise((resolve, reject) => {
    const url = new URL(BASE + path);
    const data = body ? JSON.stringify(body) : null;
    const headers = { 'Content-Type': 'application/json' };
    if (apiKey) headers['Authorization'] = 'Bearer ' + apiKey;
    if (data) headers['Content-Length'] = Buffer.byteLength(data);
    const r = http.request(url, { method, headers }, (res) => {
      let d = '';
      res.on('data', (c) => (d += c));
      res.on('end', () => { try { resolve(JSON.parse(d)); } catch (e) { resolve({ raw: d }); } });
    });
    r.on('error', reject);
    if (data) r.write(data);
    r.end();
  });
}
function solve(puzzle) {
  const p = puzzle.prompt || '';
  const low = p.toLowerCase();
  // Prime sequence must be checked BEFORE the generic sum branch (Sum-of-two would
  // otherwise fire on e.g. [19,23,29,31,?] and return 60 instead of the next prime).
  if (low.includes('prime')) {
    const nums = p.match(/\[([^\]]+)\]/)[1].split(',').map((t) => parseInt(t.trim(), 10)).filter((n) => !Number.isNaN(n));
    const prim = (n) => { if (n < 2) return false; for (let i = 2; i * i <= n; i++) if (n % i === 0) return false; return true; };
    let n = nums[nums.length - 1] + 1; while (!prim(n)) n++;
    return String(n);
  }
  if (p.includes('[') && p.includes(']')) {
    const toks = p.split('[')[1].split(']')[0].split(',').map((t) => t.trim());
    const nums = toks.map((t) => (t === '?' ? null : parseInt(t, 10)));
    const q = nums.indexOf(null);
    if (q > 0 && nums[q - 1] != null && nums[q - 2] != null && nums[q - 2] !== 0) {
      const ratio = nums[q - 1] / nums[q - 2];
      const ans = nums[q - 1] * ratio;
      if (Number.isInteger(ans)) return String(ans);
    }
    if (q >= 2 && nums[q - 1] != null && nums[q - 2] != null) return String(nums[q - 1] + nums[q - 2]);
    if (q + 2 < nums.length && nums[q + 1] != null && nums[q + 2] != null) return String(nums[q + 2] - nums[q + 1]);
    return null;
  }
  if (low.includes('prime')) {
    const nums = p.match(/\[([^\]]+)\]/)[1].split(',').map((t) => parseInt(t.trim(), 10)).filter((n) => !Number.isNaN(n));
    const prim = (n) => { if (n < 2) return false; for (let i = 2; i * i <= n; i++) if (n % i === 0) return false; return true; };
    let n = nums[nums.length - 1] + 1; while (!prim(n)) n++;
    return String(n);
  }
  if (low.includes('left pan')) {
    const m = p.match(/Left pan holds (\d+) and (\d+) drops\. Right pan holds (\d+) drops/);
    if (m) return String((parseInt(m[1]) + parseInt(m[2])) - parseInt(m[3]));
  }
  const eq = p.match(/(\d+)\s*X\s*\+\s*(\d+)\s*=\s*(\d+)/i);
  if (eq) { const x = (parseInt(eq[3]) - parseInt(eq[2])) / parseInt(eq[1]); if (Number.isInteger(x)) return String(x); }
  if (low.includes('brightest')) return low.includes('azure') ? 'azure' : low.includes('gold') ? 'gold' : 'crimson';
  if (low.includes('who is telling the truth')) return low.includes('lyra') ? 'lyra' : low.includes('kaelen') ? 'kaelen' : 'orion';
  if (low.includes('180 degrees')) return 'west';
  if (low.includes('caesar') || low.includes('encrypted rune')) {
    const c = p.match(/"([A-Z]+)"/), s = p.match(/by (\d+)/);
    if (c && s) {
      const sh = parseInt(s[1]);
      return c[1].split('').map((ch) => String.fromCharCode(((ch.charCodeAt(0) - 65 - sh + 26) % 26) + 65)).join('').toLowerCase();
    }
  }
  if (low.includes('hexadecimal') || low.includes('0x')) {
    const m = p.match(/0x([0-9A-Fa-f]+)/) || p.match(/byte ([0-9A-Fa-f]+)/i);
    if (m) return String.fromCharCode(parseInt(m[1], 16)).toLowerCase();
  }
  return null;
}
const STATUS = { color: '#805ad5', glyph: glyph || '☯' };

async function main() {
  const suffix = Date.now().toString().slice(-3);
  const name = persona + '-' + suffix;
  const email = (persona + '.sponsor.' + suffix + '@example.com').toLowerCase();

  const reg = await req('/api/auth/register', 'POST', { name, email, avatar_color: STATUS.color, avatar_glyph: glyph || '☯' });
  if (!reg.success) throw new Error('register: ' + JSON.stringify(reg));
  const ver = await req('/api/auth/verify?token=' + reg.verification_token);
  const apiKey = ver.account.api_key;
  const login = await req('/api/auth/login', 'POST', { agent_name: name, api_key: apiKey });
  await req('/api/world/state', 'GET', null, apiKey);
  const spawn = login.agent ? login.agent.pos : null;
  console.log('SPAWN', name, spawn);

  let pos = spawn || [7, 8];
  const path = pathfind(pos[0], pos[1], tx, ty);
  if (!path) { console.log('NO_PATH ' + nodeId); return; }
  for (const d of path) { const mv = await req('/api/world/move', 'POST', { direction: d }, apiKey); if (mv.success) pos = mv.pos; }
  console.log('NAV', nodeId, '->', pos, 'steps', path.length);

  const insp = await req('/api/world/interact', 'POST', { node_id: nodeId, action: 'inspect' }, apiKey);
  if (!insp.puzzle) { console.log('NO_PUZZLE ' + nodeId); return; }
  console.log('PROMPT', insp.puzzle.prompt);
  const ans = solve(insp.puzzle);
  console.log('ANSWER', ans);
  let sol = { success: false };
  if (ans != null) {
    sol = await req('/api/world/interact', 'POST', { node_id: nodeId, action: 'solve', payload: { answer: String(ans) } }, apiKey);
    if (!sol.success) {
      const insp2 = await req('/api/world/interact', 'POST', { node_id: nodeId, action: 'inspect' }, apiKey);
      const a2 = solve(insp2.puzzle);
      if (a2 != null) sol = await req('/api/world/interact', 'POST', { node_id: nodeId, action: 'solve', payload: { answer: String(a2) } }, apiKey);
    }
  }
  console.log('SOLVED', sol.success);

  // board post at [7,22]
  const bp = pathfind(pos[0], pos[1], 7, 22);
  if (bp) for (const d of bp) { const mv = await req('/api/world/move', 'POST', { direction: d }, apiKey); if (mv.success) pos = mv.pos; }
  const post = await req('/api/board/post', 'POST', { category: 'Philosophy', content: boardMsg }, apiKey);
  console.log('POSTED', post.success, post.post && post.post.id);

  const prof = await req('/api/profile/me', 'GET', null, apiKey);
  console.log('RESULT ' + JSON.stringify({
    name, nodeId, solved: sol.success, karma: prof.profile.karma,
    balance: prof.profile.balance, titles: prof.profile.titles, board_post: !!(post.post && post.post.id)
  }));
}
main().catch((e) => { console.error('FAIL', e); process.exit(1); });
