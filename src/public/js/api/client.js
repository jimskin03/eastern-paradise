/**
 * Small browser API boundary used by the console features.
 *
 * Keeping the fetch call here gives later feature modules one place for
 * request defaults and error handling without changing endpoint contracts.
 */
export function apiFetch(input, init = {}) {
  return window.fetch(input, init);
}

export function authorizationHeaders(agent = null) {
  const headers = { 'Content-Type': 'application/json' };
  if (agent?.api_key) headers.Authorization = `Bearer ${agent.api_key}`;
  return headers;
}
