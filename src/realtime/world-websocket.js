import { WebSocketServer, WebSocket } from 'ws';

export const WEBSOCKET_HEARTBEAT_MS = 30 * 1000;
export const MAX_WEBSOCKET_BUFFERED_BYTES = 1_000_000;

export function attachWorldWebSocket({ server, world, db, lifecycle }) {
  const spectatorClients = new Set();

  function safeSend(client, msg) {
    if (client.readyState !== WebSocket.OPEN) return false;
    // ws buffers writes in memory. A slow or backgrounded browser must not be
    // allowed to turn a busy world into an unbounded server-side queue.
    if (client.bufferedAmount > MAX_WEBSOCKET_BUFFERED_BYTES) {
      spectatorClients.delete(client);
      client.close(1013, 'Spectator connection is too far behind');
      return false;
    }
    client.send(msg, err => {
      if (err) spectatorClients.delete(client);
    });
    return true;
  }

  function broadcastServerStatus() {
    const statusMsg = JSON.stringify({
      type: 'server_status',
      state: lifecycle.getState(),
      connected_spectators: spectatorClients.size,
      active_agents: world.activeAgents.size
    });
    for (const client of spectatorClients) safeSend(client, statusMsg);
  }

  world.onEvent(event => {
    const payload = JSON.stringify(event);
    for (const client of spectatorClients) safeSend(client, payload);
  });

  const wss = new WebSocketServer({ server, path: '/ws/world' });
  wss.on('error', err => {
    console.error('[WebSocketServer] Error:', err.message);
  });

  wss.on('connection', ws => {
    lifecycle.markActivity();
    ws.isAlive = true;
    spectatorClients.add(ws);
    console.log(`[WebSocket] Spectator connected. Active spectators: ${spectatorClients.size}`);

    ws.on('error', () => {
      spectatorClients.delete(ws);
    });

    ws.on('pong', () => {
      ws.isAlive = true;
    });

    const recentLogs = db.prepare(`
      SELECT id, agent_id, node_id, action_type, result, created_at
      FROM interaction_logs
      ORDER BY created_at DESC
      LIMIT 25
    `).all();

    safeSend(ws, JSON.stringify({
      type: 'init_world',
      data: world.getAllEntitiesForSpectator(),
      server_state: lifecycle.getState(),
      recent_logs: recentLogs
    }));

    ws.on('message', data => {
      lifecycle.markActivity();
      try {
        const msg = JSON.parse(data.toString());
        if (msg.type === 'ping') {
          safeSend(ws, JSON.stringify({ type: 'pong', timestamp: Date.now() }));
        }
      } catch (_) {}
    });

    ws.on('close', () => {
      spectatorClients.delete(ws);
      console.log(`[WebSocket] Spectator disconnected. Remaining: ${spectatorClients.size}`);
    });
  });

  const heartbeatTimer = setInterval(() => {
    for (const client of spectatorClients) {
      if (client.isAlive === false) {
        spectatorClients.delete(client);
        client.terminate();
        continue;
      }
      client.isAlive = false;
      client.ping();
    }
  }, WEBSOCKET_HEARTBEAT_MS);
  heartbeatTimer.unref();

  wss.on('close', () => clearInterval(heartbeatTimer));

  return {
    wss,
    broadcastServerStatus,
    getClientCount() {
      return spectatorClients.size;
    }
  };
}
