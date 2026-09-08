/* Sanctuary scenery. Native isometric tiles are 34 x 17; origins sit at ground level. */
(function () {
  'use strict';

  const P = {
    shadow: 'rgba(5,28,19,.28)', wood: '#875a35', woodDark: '#593d29', woodLight: '#bb8b50',
    stone: '#75867a', stoneDark: '#52665e', stoneLight: '#a3afa0', moss: '#4e8950',
    leaf: '#49934f', leafDark: '#276a3e', gold: '#dabc58', cream: '#eadca8',
    red: '#b55439', redDark: '#773b2f', water: '#72b8ae'
  };

  function poly(c, points, color, stroke) {
    c.beginPath();
    points.forEach((p, i) => i ? c.lineTo(p[0], p[1]) : c.moveTo(p[0], p[1]));
    c.closePath(); c.fillStyle = color; c.fill();
    if (stroke) { c.strokeStyle = stroke; c.lineWidth = 1; c.stroke(); }
  }

  function oval(c, x, y, rx, ry, color) {
    c.beginPath(); c.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2); c.fillStyle = color; c.fill();
  }

  function line(c, points, color, width) {
    c.beginPath(); points.forEach((p, i) => i ? c.lineTo(p[0], p[1]) : c.moveTo(p[0], p[1]));
    c.strokeStyle = color; c.lineWidth = width || 1; c.lineCap = 'round'; c.lineJoin = 'round'; c.stroke();
  }

  // w and d are lengths along the two projected ground axes, in pixels.
  function box(c, x, y, w, d, h, top, left, right) {
    const a = [x - w / 2 + d / 2, y - w / 4 - d / 4];
    const b = [x + w / 2 + d / 2, y + w / 4 - d / 4];
    const e = [x + w / 2 - d / 2, y + w / 4 + d / 4];
    const f = [x - w / 2 - d / 2, y - w / 4 + d / 4];
    poly(c, [[f[0], f[1] - h], [e[0], e[1] - h], e, f], left);
    poly(c, [[e[0], e[1] - h], [b[0], b[1] - h], b, e], right);
    poly(c, [[a[0], a[1] - h], [b[0], b[1] - h], [e[0], e[1] - h], [f[0], f[1] - h]], top);
  }

  function rock(c, x, y, size, moss) {
    poly(c, [[x - size, y - size * .3], [x - size * .6, y - size], [x + size * .2, y - size * 1.25],
      [x + size * .85, y - size * .7], [x + size, y], [x, y + size * .35], [x - size, y]], P.stoneDark);
    poly(c, [[x - size, y - size * .3], [x - size * .6, y - size], [x + size * .2, y - size * 1.25],
      [x + size * .7, y - size * .6], [x, y - size * .2]], P.stoneLight);
    poly(c, [[x, y - size * .2], [x + size * .7, y - size * .6], [x + size, y], [x, y + size * .35]], P.stone);
    if (moss) poly(c, [[x - size * .65, y - size * .8], [x - size * .15, y - size],
      [x + size * .25, y - size * .75], [x - size * .2, y - size * .4]], P.moss);
  }

  function flame(c, x, y, size, time) {
    const sway = Math.sin((Number(time) || 0) * .004 + x) * size * .12;
    const glow = c.createRadialGradient(x, y - size * .5, 0, x, y - size * .5, size * 2.8);
    glow.addColorStop(0, 'rgba(255,181,60,.20)'); glow.addColorStop(1, 'rgba(255,181,60,0)');
    oval(c, x, y - size * .5, size * 2.8, size * 2.8, glow);
    poly(c, [[x - size * .4, y], [x - size * .5, y - size * .5], [x + sway, y - size * 1.55],
      [x + size * .45, y - size * .7], [x + size * .4, y]], '#f18737');
    poly(c, [[x - size * .2, y], [x - size * .22, y - size * .4], [x + sway * .5, y - size],
      [x + size * .2, y - size * .35], [x + size * .15, y]], '#ffe292');
  }

  function fire(c, x, y, time, size) {
    const s = size || 1;
    oval(c, x, y + 1, 12 * s, 5 * s, P.shadow);
    line(c, [[x - 7 * s, y - 3 * s], [x + 7 * s, y + 2 * s]], P.woodDark, 4 * s);
    line(c, [[x - 6 * s, y + 2 * s], [x + 6 * s, y - 4 * s]], P.woodLight, 3 * s);
    for (let i = 0; i < 7; i++) {
      const a = i * Math.PI * 2 / 7;
      rock(c, x + Math.cos(a) * 10 * s, y + Math.sin(a) * 4 * s, 2.8 * s);
    }
    flame(c, x, y - 2 * s, 9 * s, time);
  }

  function fence(c, x, y, orientation) {
    const dy = orientation === 'y' ? -7 : 7;
    line(c, [[x - 14, y - dy - 8], [x + 14, y + dy - 8]], P.woodLight, 2);
    line(c, [[x - 14, y - dy - 4], [x + 14, y + dy - 4]], P.wood, 2);
    [-1, 1].forEach(v => box(c, x + v * 14, y + v * dy, 2.4, 2.4, 12, P.woodLight, P.wood, P.woodDark));
  }

  function flower(c, x, y, variant) {
    const petals = ['#e6adcb', '#eadbd0', '#df9863', '#aa9bcd'][variant % 4];
    line(c, [[x, y], [x, y - 6]], P.leafDark, 1.2);
    poly(c, [[x, y - 2], [x - 4, y - 5], [x - 3, y - 1]], P.leaf);
    [[-2, -7], [2, -7], [0, -9], [0, -5]].forEach(p => oval(c, x + p[0], y + p[1], 1.8, 1.6, petals));
    oval(c, x, y - 7, 1.1, 1.1, P.gold);
  }

  function reeds(c, x, y, variant) {
    for (let i = 0; i < 5; i++) {
      const px = x + (i - 2) * 3, h = 12 + ((i * 7 + variant * 3) % 12);
      line(c, [[px, y], [px + (i % 2 ? 2 : -2), y - h]], i % 2 ? '#85a34c' : '#b7b75f', 1.2);
      if (i % 2) line(c, [[px + 2, y - h], [px + 2, y - h + 5]], '#9a703e', 2.4);
      line(c, [[px, y - 3], [px + (i % 2 ? -4 : 4), y - h * .65]], P.leaf, 1.2);
    }
  }

  function crop(c, x, y, variant) {
    for (let i = -1; i <= 1; i++) {
      const px = x + i * 5, py = y + i * 2.5, h = 11 + (variant + i + 3) % 3;
      line(c, [[px, py], [px, py - h]], '#87a44b', 1.2);
      line(c, [[px, py - 3], [px - 3, py - 7]], P.leaf, 1.5);
      oval(c, px, py - h, 1.8, 3.4, '#dbc25f');
      oval(c, px + 2, py - h + 3, 1.4, 2, '#e7ca67');
    }
  }

  function barrel(c, x, y) {
    oval(c, x, y, 5.5, 2.5, P.shadow);
    poly(c, [[x - 5, y - 11], [x + 5, y - 11], [x + 6, y - 5], [x + 4, y], [x - 4, y], [x - 6, y - 5]], P.wood);
    oval(c, x, y - 11, 5, 2.5, P.woodLight);
    line(c, [[x - 5.6, y - 8], [x, y - 6.6], [x + 5.6, y - 8]], P.stoneDark, 1.5);
    line(c, [[x - 5, y - 3], [x, y - 1.6], [x + 5, y - 3]], P.stoneDark, 1.5);
    line(c, [[x, y - 9], [x, y - 3]], '#b78952', .8);
  }

  function well(c, x, y) {
    oval(c, x, y + 1, 12, 5, P.shadow);
    box(c, x, y, 12, 12, 10, P.stoneLight, P.stone, P.stoneDark);
    oval(c, x, y - 10, 7, 3.4, '#304b40');
    line(c, [[x - 8, y - 11], [x - 8, y - 28], [x + 8, y - 20], [x + 8, y - 4]], P.wood, 2.4);
    line(c, [[x - 10, y - 29], [x + 11, y - 19]], P.woodLight, 3);
    line(c, [[x, y - 24], [x, y - 13]], P.cream, 1);
    box(c, x + 1, y - 9, 3, 3, 4, P.woodLight, P.wood, P.woodDark);
  }

  function bird(c, x, y, chicken, variant) {
    const dir = variant % 2 ? -1 : 1;
    c.save(); c.translate(x, y); c.scale(dir, 1);
    oval(c, 0, 0, 6, 2.5, chicken ? P.shadow : 'rgba(177,222,204,.23)');
    if (chicken) { line(c, [[-1, -2], [-1, 1]], '#c7994c', 1); line(c, [[2, -2], [2, 1]], '#c7994c', 1); }
    oval(c, 0, -4, 5, 3.5, '#e9e4c8'); oval(c, 3, -7, 2.5, 2.8, '#f4ebd2');
    poly(c, [[5, -8], [8, -7], [5, -6]], '#d3a04e');
    poly(c, [[-3, -5], [-6, -8], [-5, -3]], '#f3eed9');
    oval(c, 4, -8, .65, .7, P.woodDark);
    if (chicken) oval(c, 3, -10, 1.8, 1, '#b94e40');
    c.restore();
  }

  function drawProp(c, type, x, y, zoom, time, variant) {
    const v = typeof variant === 'number' ? Math.abs(Math.floor(variant)) : 0;
    c.save(); c.translate(x, y); c.scale(zoom, zoom);
    switch (type) {
      case 'flower': flower(c, -3, 1, v); flower(c, 3, -2, v); break;
      case 'mushroom':
        [[-3, 0, 1], [3, 2, .7]].forEach(([a, b, s]) => {
          line(c, [[a, b], [a, b - 6 * s]], P.cream, 2 * s);
          oval(c, a, b - 7 * s, 4 * s, 3 * s, v % 2 ? '#be775b' : '#d67873');
          oval(c, a - s, b - 8 * s, s, .8 * s, P.cream);
          oval(c, a + 2 * s, b - 7 * s, .7 * s, .7 * s, P.cream);
        }); break;
      case 'reeds': reeds(c, 0, 0, v); break;
      case 'crop': crop(c, 0, 0, v); break;
      case 'crate':
        oval(c, 0, 1, 10, 4, P.shadow); box(c, 0, 0, 10, 10, 11, P.woodLight, P.wood, P.woodDark);
        line(c, [[-9, -10], [-1, 3]], '#b58d56', 1.3); line(c, [[-1, -5], [-9, -2]], '#b58d56', 1.3); break;
      case 'stump':
        box(c, 0, 0, 7, 7, 7, P.woodLight, P.wood, P.woodDark);
        oval(c, 0, -7, 5, 2.6, '#d1ac73'); oval(c, 0, -7, 2.2, 1.1, '#a17a48'); break;
      case 'fence': fence(c, 0, 0, variant); break;
      case 'bench':
        box(c, -7, -3, 3, 5, 7, P.woodLight, P.wood, P.woodDark);
        box(c, 7, 4, 3, 5, 7, P.woodLight, P.wood, P.woodDark);
        box(c, 0, -5, 23, 7, 3, P.woodLight, P.wood, P.woodDark); break;
      case 'torch':
        oval(c, 0, 1, 5, 2.5, P.shadow);
        box(c, 0, 0, 4, 4, 3, '#536a58', '#334a3b', '#263a31');
        poly(c, [[-2.4, 0], [-1.5, -25], [1.5, -25], [2.4, 0]], '#384c38');
        box(c, 0, -22, 4, 4, 3, P.gold, P.woodLight, P.wood);
        flame(c, 0, -26, 6, time); break;
      case 'duck': bird(c, 0, 0, false, v); break;
      case 'chicken': bird(c, 0, 0, true, v); break;
      case 'barrel': barrel(c, 0, 0); break;
      case 'well': well(c, 0, 0); break;
      case 'lily':
        oval(c, 0, 0, 5, 2.5, '#70a351');
        poly(c, [[0, 0], [4, -2], [5, 0]], '#397b76');
        if (v % 3 === 0) { oval(c, -1, -2, 2, 1.5, '#e7c5b4'); oval(c, -1, -3, 1, 1, P.cream); } break;
      default: break;
    }
    c.restore();
  }

  function cave(c) {
    oval(c, 0, 4, 37, 13, P.shadow);
    poly(c, [[-33, 0], [-32, -21], [-21, -38], [-4, -46], [17, -39], [33, -20], [34, 3]], P.stoneDark);
    poly(c, [[-15, 5], [-15, -15], [-9, -27], [0, -33], [10, -28], [16, -15], [16, 5]], '#182b29');
    poly(c, [[-9, 4], [-9, -14], [-5, -24], [1, -28], [8, -24], [12, -13], [12, 4]], '#10231f');
    [[-28, -4, 10], [-27, -20, 9], [-18, -32, 9], [-4, -38, 9], [11, -33, 9], [25, -23, 10], [29, -7, 11]]
      .forEach((r, i) => rock(c, r[0], r[1], r[2], i % 2 === 0));
    rock(c, -32, 10, 5, true); rock(c, 29, 14, 5); rock(c, -22, 13, 3);
    poly(c, [[-12, 4], [8, 5], [17, 13], [3, 18], [-17, 10]], '#667b62');
  }

  function shrine(c) {
    box(c, 0, 4, 27, 26, 3, '#719368', '#4b7151', '#3e6249');
    [[-19, -5], [18, 13]].forEach(([x, y]) => {
      box(c, x, y, 6, 6, 4, P.stoneLight, P.stone, P.stoneDark);
      box(c, x, y - 4, 4, 4, 42, '#d07747', '#b85736', '#8d3c2c');
    });
    poly(c, [[-26, -54], [27, -28], [27, -23], [-26, -49]], P.redDark);
    poly(c, [[-31, -58], [-26, -55], [28, -28], [33, -29], [29, -23], [-28, -51]], '#bb5738');
    line(c, [[-30, -58], [28, -29], [33, -30]], '#d4864c', 2);
    line(c, [[-23, -37], [22, -15]], P.redDark, 4);
    line(c, [[-16, -40], [-8, -29], [3, -21], [15, -24]], P.cream, 1.1);
    [[-10, -32], [0, -25], [10, -25]].forEach(([x, y]) => poly(c, [[x, y], [x + 3, y + 3], [x, y + 8], [x - 2, y + 5]], '#eadfc0'));
    box(c, 0, 8, 8, 8, 9, P.woodLight, P.wood, P.woodDark);
  }

  function stones(c, time, ruined) {
    const coords = [[-11, -12, 25], [17, -9, 27], [-28, 0, 22], [30, 10, 19], [-15, 16, 16], [7, 24, 18]];
    oval(c, 0, 9, 37, 18, P.shadow);
    coords.forEach(([x, y, h], i) => {
      box(c, x, y, 7, 7, ruined && i % 2 ? h * .65 : h, P.stoneLight, P.stone, P.stoneDark);
      if (ruined || i % 2 === 0) poly(c, [[x - 6, y - 3], [x - 2, y - 8], [x + 1, y - 6], [x, y + 2]], P.moss);
    });
    if (ruined) {
      box(c, 17, -20, 24, 8, 5, '#a5ac92', P.stone, P.stoneDark);
      rock(c, -6, 7, 5, true); rock(c, 13, 16, 4, true);
      poly(c, [[-3, -4], [5, 0], [5, 11], [-3, 7]], '#3fa784');
      oval(c, 1, 3, 2, 3, '#b4deae');
    } else {
      box(c, 0, 5, 10, 10, 4, P.stoneLight, P.stone, P.stoneDark);
      const bob = Math.sin((Number(time) || 0) * .0018) * 1.5;
      const glow = c.createRadialGradient(0, -10 + bob, 1, 0, -10 + bob, 16);
      glow.addColorStop(0, 'rgba(183,146,228,.35)'); glow.addColorStop(1, 'rgba(183,146,228,0)');
      oval(c, 0, -10 + bob, 16, 16, glow);
      oval(c, 0, -10 + bob, 4.5, 6, '#bfa2df'); oval(c, -1, -12 + bob, 2.5, 3.5, '#eadcf7');
    }
  }

  function tent(c, x, y) {
    oval(c, x, y + 5, 25, 10, P.shadow);
    poly(c, [[x - 20, y], [x - 6, y - 29], [x + 17, y - 17], [x + 5, y + 13]], '#b49556');
    poly(c, [[x + 5, y + 13], [x + 17, y - 17], [x + 29, y + 3]], '#d1b571');
    poly(c, [[x + 10, y + 10], [x + 17, y - 12], [x + 24, y + 5]], '#685c3c');
    line(c, [[x - 6, y - 29], [x + 17, y - 17], [x + 18, y - 21]], P.woodLight, 2);
    line(c, [[x - 7, y - 26], [x - 28, y + 3]], '#cbb982', 1);
    line(c, [[x + 18, y - 16], [x + 36, y + 11]], '#cbb982', 1);
    line(c, [[x - 28, y + 4], [x - 28, y]], P.woodDark, 2);
    line(c, [[x + 36, y + 12], [x + 36, y + 8]], P.woodDark, 2);
  }

  function farmhouse(c) {
    oval(c, 0, 7, 33, 13, P.shadow);
    box(c, 0, 0, 28, 24, 34, '#c6b27e', '#b6a073', '#9d885e');
    poly(c, [[-26, -35], [0, -63], [29, -48], [2, -20]], '#9c513c');
    poly(c, [[2, -20], [29, -48], [28, -22]], '#b45e42');
    poly(c, [[-27, -35], [0, -63], [0, -58], [-24, -31]], '#b26c46');
    line(c, [[0, -63], [29, -48]], '#bd7750', 2);
    [-18, -11, -4, 3, 10, 17].forEach(x => line(c, [[x, -37 - (x + 26) * .5], [x + 27, -23 - (x + 26) * .5]], '#8b4938', .8));
    line(c, [[-25, -33], [-25, 0], [2, 13], [2, -20]], P.woodDark, 3);
    line(c, [[28, -22], [28, 0], [2, 13]], P.woodDark, 2.5);
    poly(c, [[-16, -22], [-6, -17], [-6, 8], [-16, 3]], '#523f2d');
    line(c, [[-16, -22], [-6, -17], [-6, 7]], P.woodLight, 2);
    poly(c, [[10, -18], [21, -24], [21, -12], [10, -6]], '#474c34');
    line(c, [[15.5, -21], [15.5, -9]], P.woodLight, 1.5);
    box(c, -11, 9, 12, 7, 3, '#b2a57d', '#817954', '#6e6d4b');
    box(c, 5, -50, 5, 6, 14, P.stoneLight, P.stone, P.stoneDark);
  }

  function headquarters(c, time) {
    // 1. Broad ground shadow under 5x5 compound
    oval(c, 0, 10, 68, 34, P.shadow);

    // 2. Elevated stone foundation terrace / compound podium
    box(c, 0, 10, 62, 46, 7, '#7b8c82', '#52635a', '#3c4d44');
    // Terrace paving contour
    poly(c, [[-30, 9], [0, -6], [30, 9], [0, 24]], '#899b90');
    line(c, [[-30, 9], [0, -6], [30, 9], [0, 24], [-30, 9]], '#a3b5a8', 1.2);

    // 3. South entrance ceremonial steps
    box(c, 0, 21, 20, 12, 4, '#94a499', '#63736a', '#47564d');
    line(c, [[-9, 21], [0, 16], [9, 21]], '#b9cbc0', 1.5);

    // 4. Lower Research Pavilion (Tier 1) - Sleek obsidian/slate walls with cyber architecture
    box(c, 0, 4, 42, 32, 26, '#2a3b36', '#1a2622', '#121d19');

    // Cyan glowing data-circuit lines along facade
    line(c, [[-20, 15], [-20, 1], [-7, 8]], 'rgba(56, 189, 248, 0.4)', 1);
    line(c, [[20, 15], [20, 1], [7, 8]], 'rgba(56, 189, 248, 0.4)', 1);

    // Front portal / entry arch
    poly(c, [[-7, 18], [7, 25], [7, 7], [-7, 0]], '#0d1513');
    poly(c, [[-5, 17], [5, 22], [5, 9], [-5, 4]], 'rgba(56, 189, 248, 0.35)');

    // Luminous entrance signage / transom
    line(c, [[-7, 0], [7, 7]], '#38bdf8', 2.5);

    // Cyber-pagoda glass window bands (Teal / Cyan data-glass)
    // Left facade window
    poly(c, [[-19, 3], [-9, 8], [-9, -4], [-19, -9]], '#123b3f');
    poly(c, [[-18, 2], [-10, 6], [-10, -3], [-18, -7]], 'rgba(56, 189, 248, 0.7)');
    line(c, [[-14, 4], [-14, -5]], 'rgba(224, 242, 254, 0.8)', 1);

    // Right facade window
    poly(c, [[9, 17], [19, 12], [19, 0], [9, 5]], '#123b3f');
    poly(c, [[10, 15], [18, 11], [18, 1], [10, 5]], 'rgba(56, 189, 248, 0.7)');
    line(c, [[14, 13], [14, 3]], 'rgba(224, 242, 254, 0.8)', 1);

    // 5. Cantilevered Mid-Roof Tier (Curved pagoda-style eaves)
    poly(c, [[-27, -16], [0, -30], [27, -16], [0, -2]], '#22322e');
    line(c, [[-27, -16], [0, -30], [27, -16], [0, -2], [-27, -16]], '#2dd4bf', 1.8);
    line(c, [[-27, -16], [0, -2]], '#38bdf8', 1.5);
    line(c, [[0, -2], [27, -16]], '#38bdf8', 1.5);

    // 6. Upper Research Core & Observatory (Tier 2)
    box(c, 0, -18, 24, 18, 20, '#22302b', '#16221e', '#0f1815');

    // Data-panoramic window slit on upper observatory
    poly(c, [[-10, -17], [0, -12], [0, -22], [-10, -27]], 'rgba(99, 102, 241, 0.6)');
    poly(c, [[0, -12], [10, -17], [10, -27], [0, -22]], 'rgba(56, 189, 248, 0.85)');

    // 7. Upper Pagoda Roof & Spire Base
    poly(c, [[-17, -37], [0, -46], [17, -37], [0, -28]], '#1b2723');
    line(c, [[-17, -37], [0, -46], [17, -37], [0, -28], [-17, -37]], '#38bdf8', 1.5);

    // Central Spire
    line(c, [[0, -42], [0, -64]], '#94a3b8', 2.2);
    line(c, [[-3, -48], [3, -48]], '#cbd5e1', 1.5);

    // 8. Animated Pulsating AI Crystal Core & Quantum Energy Aura
    const bob = Math.sin((Number(time) || 0) * 0.0035) * 2.5;
    const coreY = -70 + bob;

    // Glowing energy field
    const glow = c.createRadialGradient(0, coreY, 1, 0, coreY, 22);
    glow.addColorStop(0, 'rgba(56, 189, 248, 0.55)');
    glow.addColorStop(0.4, 'rgba(147, 51, 234, 0.28)');
    glow.addColorStop(1, 'rgba(56, 189, 248, 0)');
    oval(c, 0, coreY, 22, 22, glow);

    // Floating diamond crystal
    poly(c, [[0, coreY - 10], [6, coreY], [0, coreY + 10], [-6, coreY]], '#38bdf8');
    poly(c, [[0, coreY - 10], [0, coreY + 10], [-6, coreY]], '#0284c7');
    poly(c, [[-2, coreY - 6], [0, coreY - 8], [0, coreY + 2], [-2, coreY]], '#e0f2fe');

    // Orbiting quantum resonance ring
    const ringAngle = (Number(time) || 0) * 0.0025;
    c.save();
    c.translate(0, coreY);
    c.rotate(ringAngle);
    c.beginPath();
    c.ellipse(0, 0, 14, 5, 0, 0, Math.PI * 2);
    c.strokeStyle = 'rgba(56, 189, 248, 0.75)';
    c.lineWidth = 1.2;
    c.stroke();
    c.restore();
  }

  function drawBridge(c, x, y, zoom, variant) {
    c.save(); c.translate(x, y); c.scale(zoom, zoom);
    if (variant === 'y') c.scale(-1, 1);
    oval(c, 0, 4, 36, 15, 'rgba(13,55,44,.22)');
    box(c, 0, 0, 54, 17, 5, '#b18b53', '#86643d', '#664c33');
    for (let i = -25; i <= 25; i += 6) line(c, [[i - 8, i * .5 - 1], [i + 8, i * .5 - 9]], '#8d683f', 1);
    [[-29, -7], [-20, -19], [20, 18], [29, 6]].forEach(([a, b]) => {
      box(c, a, b, 3, 3, 12, P.woodLight, P.wood, P.woodDark);
    });
    line(c, [[-29, -16], [20, 9]], '#bb975f', 2);
    line(c, [[-20, -28], [29, -3]], '#bb975f', 2);
    c.restore();
  }

  function drawLandmark(c, landmark, x, y, zoom, time) {
    c.save(); c.translate(x, y); c.scale(zoom, zoom);
    switch (landmark.type) {
      case 'cave': cave(c); break;
      case 'shrine': shrine(c); break;
      case 'stone_circle': stones(c, time, false); break;
      case 'camp': tent(c, -11, -8); barrel(c, -28, 14); fire(c, 23, 25, time, .9); break;
      case 'farm': farmhouse(c); break;
      case 'fire_circle':
        box(c, -20, 4, 17, 6, 5, P.woodLight, P.wood, P.woodDark);
        box(c, 19, 5, 6, 17, 5, P.woodLight, P.wood, P.woodDark);
        fire(c, 0, 12, time, 1.3); break;
      case 'ruins': stones(c, time, true); break;
      case 'dock':
        box(c, 0, 3, 36, 24, 4, '#ad8650', '#805d36', '#67492f');
        for (let i = -16; i < 18; i += 5) line(c, [[i - 11, i * .5 + 5], [i + 11, i * .5 - 6]], '#87653d', 1);
        [[-28, 0], [5, 17], [27, 5]].forEach(([a, b]) => box(c, a, b, 3, 3, 11, P.woodLight, P.wood, P.woodDark));
        line(c, [[-18, -5], [-12, -27], [-2, -34], [9, -25]], P.woodDark, 1.7);
        line(c, [[9, -25], [12, 15]], '#bdc9a8', .7); barrel(c, -15, -7); break;
      case 'headquarters': headquarters(c, time); break;
      default: break;
    }
    c.restore();
  }

  window.SanctuaryScenery = {
    drawProp, drawLandmark, drawBridge,
    landmarkHeight: { cave: 52, shrine: 64, stone_circle: 44, camp: 45, farm: 73, fire_circle: 27, ruins: 43, dock: 40, headquarters: 88 }
  };
})();
