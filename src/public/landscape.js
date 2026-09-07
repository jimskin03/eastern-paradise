// Static terrain is painted once. Only water, scenery and inhabitants animate.
(() => {
  const TW = 34, TH = 17, DEPTH = 8;
  let cachedWorld = null;
  let terrain = null;
  let originX = 0;
  let water = [];
  let entities = [];
  let labels = [];

  const key = ([x, y]) => `${x},${y}`;
  function polygon(ctx, points, color) {
    ctx.fillStyle = color;
    ctx.beginPath();
    points.forEach(([x, y], i) => i ? ctx.lineTo(x, y) : ctx.moveTo(x, y));
    ctx.closePath();
    ctx.fill();
  }

  function prepare(world) {
    if (world === cachedWorld) return;
    cachedWorld = world;
    const { width, height } = world.dimensions;
    const landscape = world.landscape || {};
    const rivers = new Set([...(landscape.river || []), ...(landscape.ponds || [])].map(key));
    const paths = new Set((landscape.paths || []).map(key));
    const crossings = new Set((landscape.river_crossings || []).map(key));
    originX = height * TW / 2;
    terrain = document.createElement('canvas');
    terrain.width = Math.ceil((width + height) * TW / 2 + TW);
    terrain.height = Math.ceil((width + height) * TH / 2 + DEPTH + TH);
    const ctx = terrain.getContext('2d');
    water = [];
    entities = [];
    labels = landscape.landmarks || [];

    for (let sum = 0; sum <= width + height - 2; sum++) {
      for (let gx = Math.max(0, sum - height + 1); gx <= Math.min(width - 1, sum); gx++) {
        const gy = sum - gx;
        const tileKey = `${gx},${gy}`;
        const x = originX + (gx - gy) * TW / 2;
        const y = (gx + gy) * TH / 2;
        const isWater = rivers.has(tileKey);
        const isPath = paths.has(tileKey);
        const variation = (gx * 13 + gy * 7) % 5;
        const grasses = ['#246d47', '#267149', '#286f48', '#23704a', '#28744b'];
        const fill = isWater ? ['#216d9b', '#2479aa', '#287da9'][variation % 3]
          : isPath ? ['#44a267', '#47a66c', '#42a46a'][variation % 3] : grasses[variation];
        polygon(ctx, [[x, y], [x + TW / 2, y + TH / 2], [x, y + TH], [x - TW / 2, y + TH / 2]], fill);
        ctx.strokeStyle = isWater ? 'rgba(115,201,212,0.16)' : 'rgba(156,206,130,0.10)';
        ctx.lineWidth = 0.65;
        ctx.stroke();
        if (gx === width - 1) polygon(ctx, [[x, y + TH], [x + TW / 2, y + TH / 2], [x + TW / 2, y + TH / 2 + DEPTH], [x, y + TH + DEPTH]], isWater ? '#155474' : '#17492f');
        if (gy === height - 1) polygon(ctx, [[x - TW / 2, y + TH / 2], [x, y + TH], [x, y + TH + DEPTH], [x - TW / 2, y + TH / 2 + DEPTH]], isWater ? '#123f5c' : '#123d28');
        if (isWater) water.push([gx, gy]);
        // Bridge cells use timber decking all the way across the water.
        if (crossings.has(tileKey)) {
          polygon(ctx, [[x, y], [x + 17, y + 8.5], [x, y + 17], [x - 17, y + 8.5]], '#956c3d');
          ctx.strokeStyle = '#604729';
          ctx.lineWidth = 1;
          for (let p = -8; p <= 8; p += 8) {
            ctx.beginPath(); ctx.moveTo(x + p, y + Math.abs(p) / 2);
            ctx.lineTo(x + p, y + TH - Math.abs(p) / 2); ctx.stroke();
          }
        }
      }
    }
    const add = (kind, data, pos = data.pos) => entities.push({ kind, data, pos, depth: pos[0] + pos[1] });
    (landscape.trees || []).forEach(pos => add('tree', {}, pos));
    (landscape.rocks || []).forEach(pos => add('rock', {}, pos));
    (landscape.props || []).forEach(prop => add('prop', prop));
    (landscape.bridges || []).forEach(bridge => add('bridge', bridge));
    labels.forEach(landmark => add('landmark', landmark));
    for (const zone of world.zones) {
      for (const node of zone.nodes || []) {
        if (node.type !== 'landmark') add('node', node);
      }
    }
    entities.sort((a, b) => a.depth - b.depth || a.pos[0] - b.pos[0]);
  }

  function drawLabel(ctx, text, x, y, scale = 1) {
    ctx.font = `600 ${Math.max(12, Math.round(13 * scale))}px sans-serif`;
    const w = ctx.measureText(text).width;
    ctx.fillStyle = 'rgba(12,38,26,0.9)';
    ctx.fillRect(x - w / 2 - 5, y - 13, w + 10, 18);
    ctx.textAlign = 'center';
    ctx.fillStyle = '#f5df87';
    ctx.fillText(text, x, y);
  }

  function draw(options) {
    const { ctx, world, camera, agents, hoveredTile, time, helpers } = options;
    prepare(world);
    const z = camera.zoom;
    ctx.drawImage(terrain, camera.offsetX - originX * z, camera.offsetY, terrain.width * z, terrain.height * z);

    // Subtle current glints are independent of the cached terrain.
    ctx.strokeStyle = 'rgba(124,214,222,0.30)';
    ctx.lineWidth = Math.max(0.6, z);
    ctx.beginPath();
    for (const [gx, gy] of water) {
      if ((gx * 7 + gy * 11) % 5) continue;
      const { x, y } = helpers.gridToIso(gx, gy);
      const shift = Math.sin(time / 1200 + gx + gy) * 3 * z;
      ctx.moveTo(x - 4 * z + shift, y + 9 * z);
      ctx.lineTo(x + 2 * z + shift, y + 12 * z);
    }
    ctx.stroke();

    if (hoveredTile && Number.isInteger(hoveredTile.gx)) {
      const { x, y } = helpers.gridToIso(hoveredTile.gx, hoveredTile.gy);
      ctx.strokeStyle = '#f4d77b'; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + 17 * z, y + 8.5 * z);
      ctx.lineTo(x, y + 17 * z); ctx.lineTo(x - 17 * z, y + 8.5 * z); ctx.closePath(); ctx.stroke();
    }

    const ordered = [...entities];
    for (const agent of agents.values()) ordered.push({ kind: 'agent', data: agent, pos: [agent.renderGx, agent.renderGy], depth: agent.renderGx + agent.renderGy });
    ordered.sort((a, b) => a.depth - b.depth || a.pos[0] - b.pos[0]);
    const scenery = window.SanctuaryScenery;
    for (const entity of ordered) {
      const { x, y } = helpers.gridToIso(...entity.pos);
      const feetY = y + TH / 2 * z;
      if (x < -130 * z || x > ctx.canvas.width + 130 * z || feetY < -30 || feetY > ctx.canvas.height + 180 * z) continue;
      switch (entity.kind) {
        case 'tree': helpers.drawTree(ctx, x, feetY, 0.76 + (entity.pos[0] * 3 + entity.pos[1]) % 5 * 0.08); break;
        case 'rock': helpers.drawRock(ctx, x, feetY, 0.8 + entity.pos[0] % 3 * 0.12); break;
        case 'prop': scenery?.drawProp(ctx, entity.data.type, x, feetY, z, time, entity.data.variant || 0); break;
        case 'bridge': scenery?.drawBridge(ctx, x, feetY, z, entity.data.variant); break;
        case 'landmark': scenery?.drawLandmark(ctx, entity.data, x, feetY, z, time); break;
        case 'node': helpers.drawNode(ctx, entity.data, x, feetY, time); break;
        case 'agent': helpers.drawAgent(ctx, x, feetY, entity.data, time, hoveredTile?.agentId === entity.data.id); break;
      }
    }
    // Labels stay readable above the forest, and remain inspectable when zoomed out.
    const heights = scenery?.landmarkHeight || {};
    for (const landmark of labels) {
      const { x, y } = helpers.gridToIso(...landmark.pos);
      if (x < 70 || x > ctx.canvas.width - 70 || y < 75 || y > ctx.canvas.height - 10) continue;
      drawLabel(ctx, landmark.name, x, y - ((heights[landmark.type] || 38) + 7) * z, Math.min(1.15, z));
    }
  }

  window.SanctuaryLandscape = { draw };
})();
