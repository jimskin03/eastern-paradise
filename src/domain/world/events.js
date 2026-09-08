export function onEvent(world, listener) {
  world.listeners.add(listener);
  return () => world.listeners.delete(listener);
}

export function broadcast(world, event) {
  for (const listener of world.listeners) {
    try {
      listener(event);
    } catch (err) {
      console.error('[WorldEngine] Listener error:', err);
    }
  }
}
