/**
 * Transitional bridge for existing inline onclick handlers and spectator.js.
 * The bridge can be removed once those consumers use module imports/events.
 */
export function installGlobals(functions, state = {}) {
  for (const [name, value] of Object.entries(functions)) {
    if (typeof value === 'function') window[name] = value;
  }

  if (state.getCurrentAgent) {
    try {
      Object.defineProperty(window, 'currentAgent', {
        configurable: true,
        get: state.getCurrentAgent,
        set: state.setCurrentAgent || (() => {})
      });
    } catch (_) {
      window.currentAgent = state.getCurrentAgent();
    }
  }
}
