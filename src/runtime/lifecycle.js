const IDLE_TIMEOUT_MS = 30 * 1000;

export function createLifecycle({ world, residentManager }) {
  let serverState = 'ACTIVE';
  let lastActivityTime = Date.now();
  let tickInterval = null;
  let realtimeGateway = null;

  function getConnectedSpectatorCount() {
    return realtimeGateway?.getClientCount() || 0;
  }

  function start() {
    if (tickInterval) return;
    tickInterval = setInterval(() => {
      const now = Date.now();
      const hasSpectators = getConnectedSpectatorCount() > 0;
      const hasRecentActivity = (now - lastActivityTime) < IDLE_TIMEOUT_MS;

      if (!hasSpectators && !hasRecentActivity) {
        serverState = 'IDLE';
        console.log('[Lifecycle] No visitors or active connections. Server entering IDLE SLEEP (ticks suspended).');
        clearInterval(tickInterval);
        tickInterval = null;
        return;
      }

      residentManager.tick();
      world.tickAmbientWandering();
      for (const [id, agent] of world.activeAgents.entries()) {
        if (agent.is_resident) continue;
        if (now - agent.last_active > 10 * 60 * 1000) {
          world.removeAgent(id);
        }
      }
    }, 3000);
  }

  function markActivity() {
    lastActivityTime = Date.now();
    if (serverState === 'IDLE') {
      serverState = 'ACTIVE';
      console.log('[Lifecycle] Visitor detected. Server WAKING UP from idle mode -> ACTIVE.');
      start();
      realtimeGateway?.broadcastServerStatus();
    }
  }

  return {
    markActivity,
    start,
    setRealtimeGateway(gateway) {
      realtimeGateway = gateway;
    },
    getState() {
      return serverState;
    },
    getLastActivityTime() {
      return lastActivityTime;
    },
    getIdleTimeoutMs() {
      return IDLE_TIMEOUT_MS;
    },
    getConnectedSpectatorCount
  };
}
