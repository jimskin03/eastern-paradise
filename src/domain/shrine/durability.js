export function isDurableShrineRequired(env = process.env) {
  return String(env?.REQUIRE_DURABLE_SHRINE || '').trim() === '1';
}

export async function confirmShrineDurability(storage, { required = isDurableShrineRequired() } = {}) {
  if (storage?.isEnabled?.()) {
    try {
      const result = await storage.pushToCloud();
      return { durable: true, mode: 'cloud', result };
    } catch (cause) {
      const err = new Error(`Durable shrine synchronization failed: ${cause?.message || cause}`);
      err.code = 'DURABILITY_UNAVAILABLE';
      err.cause = cause;
      throw err;
    }
  }

  if (required) {
    const err = new Error('Durable shrine persistence is required, but no authoritative cloud store is configured.');
    err.code = 'DURABILITY_UNAVAILABLE';
    throw err;
  }

  return { durable: false, mode: 'local-only' };
}
