const IDLE_TIMEOUT_MS = 30 * 1000;
const SIMULATION_INTERVAL_MS = 3 * 1000;

/**
 * Owns the server-side simulation clock. The next tick is only scheduled once
 * the current one has completed, so slow I/O can never create overlapping
 * resident updates.
 */
export function createLifecycle({ world, residentManager }) {
  let serverState = 'ACTIVE';
  let lastActivityTime = Date.now();
  let lastTickAt = null;
  let tickTimer = null;
  let tickInFlight = false;
  let realtimeGateway = null;
  const metrics = {
    completedTicks: 0,
    lastTickDurationMs: 0,
    longestTickDurationMs: 0,
    lastDeltaMs: 0
  };

  function getConnectedSpectatorCount() {
    return realtimeGateway?.getClientCount() || 0;
  }

  function scheduleNextTick(delay = SIMULATION_INTERVAL_MS) {
    if (tickTimer || tickInFlight || serverState === 'IDLE') return;
    tickTimer = setTimeout(runSimulationTick, delay);
  }

  async function runSimulationTick() {
    tickTimer = null;
    if (tickInFlight || serverState === 'IDLE') return false;

    tickInFlight = true;
    const startedAt = Date.now();
    try {
      const hasSpectators = getConnectedSpectatorCount() > 0;
      const hasRecentActivity = (startedAt - lastActivityTime) < IDLE_TIMEOUT_MS;
      if (!hasSpectators && !hasRecentActivity) {
        serverState = 'IDLE';
        lastTickAt = null;
        console.log('[Lifecycle] No visitors or active connections. Server entering IDLE SLEEP (ticks suspended).');
        return false;
      }

      const deltaMs = Math.max(0, startedAt - (lastTickAt ?? startedAt));
      lastTickAt = startedAt;
      metrics.lastDeltaMs = deltaMs;

      await residentManager.tick({ now: startedAt, deltaMs });
      await world.tickAmbientWandering(deltaMs);
      for (const [id, agent] of world.activeAgents.entries()) {
        if (agent.is_resident) continue;
        if (startedAt - agent.last_active > 10 * 60 * 1000) {
          world.removeAgent(id);
        }
      }
      metrics.completedTicks += 1;
      return true;
    } catch (err) {
      console.error('[Lifecycle] Simulation tick failed:', err);
      return false;
    } finally {
      metrics.lastTickDurationMs = Math.max(0, Date.now() - startedAt);
      metrics.longestTickDurationMs = Math.max(metrics.longestTickDurationMs, metrics.lastTickDurationMs);
      tickInFlight = false;
      if (serverState === 'ACTIVE') scheduleNextTick();
    }
  }

  function start() {
    if (serverState === 'IDLE') serverState = 'ACTIVE';
    if (lastTickAt === null) lastTickAt = Date.now();
    scheduleNextTick();
  }

  function markActivity() {
    lastActivityTime = Date.now();
    if (serverState === 'IDLE') {
      serverState = 'ACTIVE';
      lastTickAt = Date.now();
      console.log('[Lifecycle] Visitor detected. Server WAKING UP from idle mode -> ACTIVE.');
      start();
      realtimeGateway?.broadcastServerStatus();
    }
  }

  return {
    markActivity,
    start,
    runSimulationTick,
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
    getConnectedSpectatorCount,
    getSimulationMetrics() {
      return { ...metrics, tickInFlight, nextTickScheduled: Boolean(tickTimer) };
    }
  };
}
