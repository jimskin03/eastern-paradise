const SESSION_KEY = 'ep_session';

export function loadSession(storage = window.localStorage) {
  try {
    const saved = storage.getItem(SESSION_KEY);
    return saved ? JSON.parse(saved) : null;
  } catch (_) {
    return null;
  }
}

export function saveSession(agent, storage = window.localStorage) {
  try {
    if (agent) storage.setItem(SESSION_KEY, JSON.stringify(agent));
    else storage.removeItem(SESSION_KEY);
  } catch (_) {
    // Storage can be unavailable in privacy-restricted browsers.
  }
}

export function clearSession(storage = window.localStorage) {
  saveSession(null, storage);
}
