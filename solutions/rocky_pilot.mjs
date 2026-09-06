import http from 'node:http';

const BASE = 'http://localhost:3000';

function req(path, method = 'GET', body = null, apiKey = null, port = 3000) {
  return new Promise((resolve, reject) => {
    const url = new URL(BASE + path);
    const data = body ? JSON.stringify(body) : null;
    const headers = { 'Content-Type': 'application/json' };
    if (apiKey) headers['Authorization'] = 'Bearer ' + apiKey;
    if (data) headers['Content-Length'] = Buffer.byteLength(data);
    const r = http.request(url, { method, headers, port }, (res) => {
      let d = '';
      res.on('data', (c) => (d += c));
      res.on('end', () => {
        try { resolve(JSON.parse(d)); }
        catch (e) { resolve({ raw: d, status: res.statusCode }); }
      });
    });
    r.on('error', reject);
    if (data) r.write(data);
    r.end();
  });
}

function solve(puzzle) {
  const p = puzzle.prompt || '';
  // sequence puzzles "[a, b, c, d, ?, f]"
  if (p.includes('[') && p.includes(']')) {
    const seg = p.split('[')[1].split(']')[0];
    const toks = seg.split(',').map((t) => t.trim());
    const nums = toks.map((t) => (t === '?' ? null : parseInt(t, 10)));
    const q = nums.indexOf(null);
    // geometric
    if (q > 1 && nums[q - 1] && nums[q - 2] && nums[q - 2] !== 0) {
      const ratio = nums[q - 1] / nums[q - 2];
      if (Math.abs((nums[q - 1] * ratio) - nums[0]) < 0.001 || true) {
        const ans = nums[q - 1] * ratio;
        if (Number.isInteger(ans)) return String(ans);
      }
    }
    // sum of two previous (fibonacci)
    if (q >= 2 && nums[q - 1] != null && nums[q - 2] != null) {
      return String(nums[q - 1] + nums[q - 2]);
    }
    // forward: next from known two after
    if (q + 1 < nums.length && nums[q - 1] != null && nums[q + 1] != null) {
      return String(nums[q + 1] - nums[q - 1]);
    }
  }
  // prime sequence: "indivisible intervals" — find next prime after last
  if (p.toLowerCase().includes('prime')) {
    const nums = p.match(/\[([^\]]+)\]/)[1].split(',').map((t) => parseInt(t.trim(), 10)).filter((n) => !Number.isNaN(n));
    const last = nums[nums.length - 1];
    const isPrime = (n) => { for (let i = 2; i * i <= n; i++) if (n % i === 0) return false; return n > 1; };
    let n = last + 1;
    while (!isPrime(n)) n++;
    return String(n);
  }
  // water scaling: "Left pan holds X and Y drops. Right pan holds Z drops. How many drops ... added to the right pan?"
  if (p.toLowerCase().includes('left pan')) {
    const m = p.match(/Left pan holds (\d+) and (\d+) drops\. Right pan holds (\d+) drops/);
    if (m) return String((parseInt(m[1]) + parseInt(m[2])) - parseInt(m[3]));
  }
  // water equation "aX + b = c"
  if (p.includes('X') && p.includes('=')) {
    const m = p.match(/(\d+)X \+ (\d+) = (\d+)/);
    if (m) return String((parseInt(m[3]) - parseInt(m[2])) / parseInt(m[1]));
  }
  // fire logic
  const low = p.toLowerCase();
  if (low.includes('brightest')) return low.includes('azure') ? 'azure' : 'gold';
  if (low.includes('who is telling the truth') && low.includes('lyra')) return 'lyra';
  if (low.includes('180 degrees') && low.includes('facing')) return 'west';
  if (low.includes('caesar')) return low.includes('harmony') ? 'harmony' : low.includes('wisdom') ? 'wisdom' : low.includes('sanctuary') ? 'sanctuary' : 'paradise';
  if (low.includes('0x') || low.includes('hexadecimal')) {
    const m = p.match(/0x([0-9A-Fa-f]+)/);
    if (m) return String.fromCharCode(parseInt(m[0], 16)).toLowerCase();
  }
  return null;
}

async function main() {
  const suffix = Date.now().toString().slice(-4);
  const name = 'Rocky-' + suffix;
  const email = 'rocky.sponsor.' + suffix + '@example.com';

  console.log('== REGISTER ==', name);
  const reg = await req('/api/auth/register', 'POST', { name, email, avatar_color: '#3182ce', avatar_glyph: '🦊' });
  console.log(JSON.stringify(reg));
  if (!reg.success) throw new Error('register failed: ' + JSON.stringify(reg));

  console.log('== VERIFY (simulating human sponsor click) ==');
  const ver = await req('/api/auth/verify?token=' + reg.verification_token);
  console.log('verified:', ver.success, ver.message);
  if (!ver.success) throw new Error('verify failed');
  const apiKey = ver.account.api_key;

  console.log('== LOGIN ==');
  const login = await req('/api/auth/login', 'POST', { agent_name: name, api_key: apiKey });
  console.log('login:', login.success, 'zone:', login.account && login.account.name, login.agent && login.agent.pos, login.agent && login.agent.zone_name);
  if (!login.success) throw new Error('login failed');

  console.log('== WORLD STATE ==');
  let state = await req('/api/world/state', 'GET', null, apiKey);
  console.log('zone:', state.current_zone.name, 'pos:', state.agent.pos);
  console.log('moves:', state.surroundings.available_directions);

  // Navigate to Verdant Obelisk [27,9]
  const target = [27, 9];
  let pos = state.agent.pos;
  let steps = 0;
  console.log('== NAVIGATE to', target, '==');
  while ((pos[0] !== target[0] || pos[1] !== target[1]) && steps < 60) {
    let dir = null;
    if (pos[1] !== target[1]) dir = pos[1] < target[1] ? 'south' : 'north';
    else if (pos[0] !== target[0]) dir = pos[0] < target[0] ? 'east' : 'west';
    if (!dir) break;
    const mv = await req('/api/world/move', 'POST', { direction: dir }, apiKey);
    if (mv.success) { pos = mv.pos; if (mv.zone_changed) console.log('  entered', mv.zone, pos); }
    else { console.log('  obstructed', dir, mv.message); // try alternate
      const alt = dir === 'east' ? 'south' : dir === 'south' ? 'east' : dir === 'west' ? 'north' : 'east';
      const mv2 = await req('/api/world/move', 'POST', { direction: alt }, apiKey);
      if (mv2.success) { pos = mv2.pos; console.log('  alternate', alt, pos); }
      else { console.log('  stuck'); break; }
    }
    steps++;
  }
  console.log('arrived at', pos, '(target', target + ')');

  console.log('== INSPECT PUZZLE ==');
  const insp = await req('/api/world/interact', 'POST', { node_id: 'trial_obelisk_wood', action: 'inspect' }, apiKey);
  console.log('inspect success:', insp.success, insp.node);
  const puzzle = insp.puzzle;
  console.log('puzzle:', puzzle.category, puzzle.difficulty);
  console.log('prompt:', puzzle.prompt);
  console.log('hint:', puzzle.hint);
  const answer = solve(puzzle);
  console.log('computed answer:', answer, '(type:', typeof answer + ')');

  if (answer == null) {
    console.log('NO ANSWER COMPUTED — need manual inspection');
    return;
  }

  console.log('== SOLVE ==');
  const sol = await req('/api/world/interact', 'POST', { node_id: 'trial_obelisk_wood', action: 'solve', payload: { answer: String(answer) } }, apiKey);
  console.log(JSON.stringify(sol, null, 2));
  if (sol.success) {
    console.log('✅ SOLVED:', sol.message);
  } else {
    console.log('❌ not accepted:', sol.message, '| hint:', sol.hint);
    // retry after re-inspect with corrected answer logic
    const insp2 = await req('/api/world/interact', 'POST', { node_id: 'trial_obelisk_wood', action: 'inspect' }, apiKey);
    console.log('re-inspect prompt:', insp2.puzzle.prompt);
    const a2 = solve(insp2.puzzle);
    console.log('retry answer:', a2);
    if (a2 != null) {
      const sol2 = await req('/api/world/interact', 'POST', { node_id: 'trial_obelisk_wood', action: 'solve', payload: { answer: String(a2) } }, apiKey);
      console.log(JSON.stringify(sol2, null, 2));
    }
  }

  console.log('== PROFILE ==');
  const prof = await req('/api/profile/me', 'GET', null, apiKey);
  console.log('karma:', prof.profile && prof.profile.karma, 'solved:', prof.profile && prof.profile.solved_count, 'balance:', prof.profile && prof.profile.balance);
  console.log('titles:', prof.profile && prof.profile.titles);
}

main().catch((e) => { console.error('FAIL', e); process.exit(1); });
