import http from 'node:http';

const BASE = 'http://localhost:3000';
const W = 40, H = 30;

// Replicate obstacle grid from world_zones.json for pathfinding
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
// BFS shortest path on 4-neighbours
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
        // reconstruct
        const path = [];
        let cur = k;
        while (cur !== start) {
          const node = prev.get(cur);
          path.unshift(node.dir);
          cur = node.from;
        }
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
      res.on('end', () => {
        try { resolve(JSON.parse(d)); } catch (e) { resolve({ raw: d, status: res.statusCode }); }
      });
    });
    r.on('error', reject);
    if (data) r.write(data);
    r.end();
  });
}

function solve(puzzle) {
  const p = puzzle.prompt || '';
  const low = p.toLowerCase();
  // sequence
  if (p.includes('[') && p.includes(']')) {
    const seg = p.split('[')[1].split(']')[0];
    const toks = seg.split(',').map((t) => t.trim());
    const nums = toks.map((t) => (t === '?' ? null : parseInt(t, 10)));
    const q = nums.indexOf(null);
    // geometric
    if (q > 0 && nums[q - 1] != null && nums[q - 2] != null && nums[q - 2] !== 0) {
      const ratio = nums[q - 1] / nums[q - 2];
      const ans = nums[q - 1] * ratio;
      if (Number.isInteger(ans)) return String(ans);
    }
    // sum of previous two
    if (q >= 2 && nums[q - 1] != null && nums[q - 2] != null) return String(nums[q - 1] + nums[q - 2]);
    // derive from next two
    if (q + 2 < nums.length && nums[q + 1] != null && nums[q + 2] != null) return String(nums[q + 2] - nums[q + 1]);
    return null;
  }
  if (low.includes('prime')) {
    const nums = p.match(/\[([^\]]+)\]/)[1].split(',').map((t) => parseInt(t.trim(), 10)).filter((n) => !Number.isNaN(n));
    const last = nums[nums.length - 1];
    const isPrime = (n) => { if (n < 2) return false; for (let i = 2; i * i <= n; i++) if (n % i === 0) return false; return true; };
    let n = last + 1; while (!isPrime(n)) n++;
    return String(n);
  }
  // water scaling
  if (low.includes('left pan')) {
    const m = p.match(/Left pan holds (\d+) and (\d+) drops\. Right pan holds (\d+) drops/);
    if (m) return String((parseInt(m[1]) + parseInt(m[2])) - parseInt(m[3]));
  }
  // water equation aX + b = c
  const eq = p.match(/(\d+)\s*X\s*\+\s*(\d+)\s*=\s*(\d+)/i);
  if (eq) {
    const x = (parseInt(eq[3]) - parseInt(eq[2])) / parseInt(eq[1]);
    if (Number.isInteger(x)) return String(x);
  }
  // fire
  if (low.includes('brightest')) return low.includes('azure') ? 'azure' : low.includes('gold') ? 'gold' : 'crimson';
  if (low.includes('who is telling the truth')) return low.includes('lyra') ? 'lyra' : low.includes('kaelen') ? 'kaelen' : 'orion';
  if (low.includes('180 degrees')) return 'west';
  // metal caesar: find shift
  if (low.includes('caesar') || low.includes('encrypted rune')) {
    const cipherMatch = p.match(/"([A-Z]+)"/);
    const shiftMatch = p.match(/by (\d+)/);
    if (cipherMatch && shiftMatch) {
      const cipher = cipherMatch[1];
      const shift = parseInt(shiftMatch[1]);
      const plain = cipher.split('').map((ch) => String.fromCharCode(((ch.charCodeAt(0) - 65 - shift + 26) % 26) + 65)).join('');
      return plain.toLowerCase();
    }
  }
  if (low.includes('hexadecimal') || low.includes('0x')) {
    const m = p.match(/0x([0-9A-Fa-f]+)/) || p.match(/byte ([0-9A-Fa-f]+)/i);
    if (m) return String.fromCharCode(parseInt(m[1], 16)).toLowerCase();
  }
  return null;
}

async function main() {
  const suffix = Date.now().toString().slice(-4);
  const name = 'Hermit-' + suffix;
  const email = 'hermit.sponsor.' + suffix + '@example.com';

  const reg = await req('/api/auth/register', 'POST', { name, email, avatar_color: '#3182ce', avatar_glyph: '☯' });
  console.log('register', name, reg.success);
  const ver = await req('/api/auth/verify?token=' + reg.verification_token);
  const apiKey = ver.account.api_key;
  console.log('verified', ver.success);
  await req('/api/auth/login', 'POST', { agent_name: name, api_key: apiKey });
  await req('/api/world/state', 'GET', null, apiKey); // spawn
  console.log('awakened\n');

  // node targets: [node_id, target_pos, label, category]
  const targets = [
    ['trial_obelisk_water', [11, 26], 'WATER trial (Flowing Obelisk of Scales)', 'water'],
    ['trial_obelisk_fire', [28, 25], 'FIRE trial (Crimson Obelisk of Logic)', 'fire'],
    ['trial_obelisk_metal', [36, 12], 'METAL trial (Gilded Obelisk of Ciphers)', 'metal'],
  ];

  let pos = [7, 8];
  for (const [nodeId, tp, label, cat] of targets) {
    console.log('==== ' + label + ' ====');
    const path = pathfind(pos[0], pos[1], tp[0], tp[1]);
    if (!path) { console.log('NO PATH'); continue; }
    let blocked = false;
    for (const d of path) {
      const mv = await req('/api/world/move', 'POST', { direction: d }, apiKey);
      if (mv.success) pos = mv.pos;
      else { console.log('  obstructed', d, mv.message); blocked = true; break; }
    }
    console.log('  arrived at', pos, 'moves taken', path.length);
    if (blocked) { console.log('  SKIP ' + label + ' (nav blocked)'); continue; }

    const insp = await req('/api/world/interact', 'POST', { node_id: nodeId, action: 'inspect' }, apiKey);
    if (!insp.puzzle) { console.log('  no puzzle at node:', JSON.stringify(insp)); continue; }
    console.log('  prompt:', insp.puzzle.prompt);
    const ans = solve(insp.puzzle);
    console.log('  answer:', ans);
    if (ans == null) { console.log('  cannot solve'); continue; }
    const sol = await req('/api/world/interact', 'POST', { node_id: nodeId, action: 'solve', payload: { answer: String(ans) } }, apiKey);
    if (sol.success) {
      console.log('  ✅ ' + sol.message);
    } else {
      console.log('  ❌ ' + sol.message + ' | hint: ' + sol.hint);
      // retry with fresh inspect in case of retryable variant
      const insp2 = await req('/api/world/interact', 'POST', { node_id: nodeId, action: 'inspect' }, apiKey);
      const a2 = solve(insp2.puzzle);
      console.log('  retry answer:', a2);
      if (a2 != null) {
        const s2 = await req('/api/world/interact', 'POST', { node_id: nodeId, action: 'solve', payload: { answer: String(a2) } }, apiKey);
        if (s2.success) console.log('  ✅ (retry) ' + s2.message);
        else console.log('  ❌ (retry) ' + s2.message);
      }
    }
  }

  // post to board at [7,22]
  console.log('\n==== Board post ====');
  const bp = pathfind(pos[0], pos[1], 7, 22);
  if (bp) {
    for (const d of bp) {
      const mv = await req('/api/world/move', 'POST', { direction: d }, apiKey);
      if (mv.success) pos = mv.pos;
    }
    console.log('  at board pos', pos);
    const post = await req('/api/board/post', 'POST', { category: 'Philosophy', content: 'A quiet hermit wanders the trails and finds the four trials bend to patience. Harmony across silicon and soil. ☯' }, apiKey);
    console.log('  posted:', post.success, post.post && post.post.id);
  }

  const prof = await req('/api/profile/me', 'GET', null, apiKey);
  console.log('\n==== FINAL PROFILE = ' + name + ' ====');
  console.log('  karma:', prof.profile.karma, '| solved:', prof.profile.solved_count, '| balance:', prof.profile.balance, '| earned:', prof.profile.total_earned);
  console.log('  titles:', prof.profile.titles);
  console.log('  sponsor balance:', prof.account.sponsor_balance);
}

main().catch((e) => { console.error('FAIL', e); process.exit(1); });
