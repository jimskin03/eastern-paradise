// More (•••) hotbar menu: reliable open/close on every viewport.
//
// Root cause (mobile): the floating map bar scrolls horizontally on ≤768px
// (responsive.css sets overflow-x: auto). An overflow container clips the
// absolutely-positioned .map-tools-menu-items popup that opens ABOVE the bar
// (bottom: calc(100% + 0.5rem)), so the native <details> toggle "worked" but
// the menu was invisible on phones.
//
// Fix: while the mobile media query matches, teleport the open panel to
// <body> and pin it with position: fixed above the summary (fixed elements
// escape ancestor overflow clipping). Restore the node into the <details>
// on close so native show/hide semantics keep working. Desktop is untouched.

const MOBILE_QUERY = '(max-width: 768px)';
const VIEWPORT_PAD = 8;

export function initMoreMenu() {
  const menu = document.querySelector('.floating-map-bar .map-tools-menu');
  const summary = menu?.querySelector('summary');
  const panel = menu?.querySelector('.map-tools-menu-items');
  if (!menu || !summary || !panel) return;

  const mq = window.matchMedia(MOBILE_QUERY);
  const isTeleported = () => panel.dataset.teleported === '1';

  function positionPanel() {
    if (!isTeleported()) {
      panel.dataset.teleported = '1';
      document.body.appendChild(panel);
    }
    panel.style.position = 'fixed';
    panel.style.bottom = 'auto';
    panel.style.right = 'auto';
    panel.style.zIndex = '320';
    panel.style.maxWidth = `calc(100vw - ${VIEWPORT_PAD * 2}px)`;

    const rect = summary.getBoundingClientRect();
    const pw = panel.offsetWidth;
    const ph = panel.offsetHeight;
    const left = Math.min(
      Math.max(VIEWPORT_PAD, rect.right - pw),
      window.innerWidth - pw - VIEWPORT_PAD
    );
    const top = Math.max(VIEWPORT_PAD, rect.top - ph - VIEWPORT_PAD);
    panel.style.left = `${left}px`;
    panel.style.top = `${top}px`;
  }

  function restorePanel() {
    if (!isTeleported()) return;
    delete panel.dataset.teleported;
    panel.removeAttribute('style');
    menu.appendChild(panel);
  }

  function syncPlacement() {
    if (menu.open && mq.matches) positionPanel();
    else restorePanel();
  }

  menu.addEventListener('toggle', syncPlacement);
  mq.addEventListener?.('change', syncPlacement);
  window.addEventListener('resize', syncPlacement);
  const onScrollReposition = () => {
    if (menu.open && mq.matches) positionPanel();
  };
  window.addEventListener('scroll', onScrollReposition, { passive: true });
  menu.closest('.floating-map-bar')?.addEventListener('scroll', onScrollReposition, { passive: true });

  // Tap/click outside closes the menu (native <details> has no outside-close).
  document.addEventListener('pointerdown', (e) => {
    if (!menu.open || !mq.matches) return;
    if (panel.contains(e.target) || summary.contains(e.target)) return;
    menu.open = false;
  }, true);

  // Selecting an item closes the menu on every viewport size.
  panel.addEventListener('click', (e) => {
    if (e.target.closest('button')) menu.open = false;
  });
}
