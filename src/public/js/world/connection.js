// Own one live stream and one reconnect timer. Returning to a visible page
// opens a new stream, whose init_world snapshot includes missed changes.
export function createWorldConnection({
  url, onOpen, onMessage, onClose, onPause, onSocket,
  page = document, Socket = WebSocket
}) {
  let socket = null;
  let reconnectTimer = null;
  let retryDelayMs = 3000;

  function pause() {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
    if (socket) {
      const previous = socket;
      socket = null;
      previous.onopen = previous.onmessage = previous.onclose = null;
      previous.close();
    }
    onSocket?.(null);
    onPause?.();
  }

  function connect() {
    if (page.hidden || socket) return;
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
    socket = new Socket(url);
    onSocket?.(socket);
    socket.onopen = () => {
      retryDelayMs = 3000;
      onOpen?.();
    };
    socket.onmessage = onMessage;
    socket.onclose = () => {
      socket = null;
      onSocket?.(null);
      if (page.hidden) return;
      onClose?.();
      reconnectTimer = setTimeout(connect, retryDelayMs);
      retryDelayMs = Math.min(30_000, retryDelayMs * 2);
    };
  }

  function onVisibilityChange() {
    if (page.hidden) pause();
    else connect();
  }

  page.addEventListener('visibilitychange', onVisibilityChange);
  connect();
  return {
    connect,
    pause,
    dispose() {
      page.removeEventListener('visibilitychange', onVisibilityChange);
      pause();
    }
  };
}
