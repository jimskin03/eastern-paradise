// A hidden page is not a spectator. Refresh once on return, then resume polling.
export function startVisiblePolling(refresh, intervalMs, page = document) {
  const refreshIfVisible = () => { if (!page.hidden) refresh(); };
  refreshIfVisible();
  const timer = setInterval(refreshIfVisible, intervalMs);
  page.addEventListener('visibilitychange', refreshIfVisible);
  return () => {
    clearInterval(timer);
    page.removeEventListener('visibilitychange', refreshIfVisible);
  };
}
