const IOS_PWA_VIEWPORT_HEIGHT = '--sable-ios-pwa-viewport-height';
const MIN_KEYBOARD_HEIGHT = 100;

const isStandaloneIosPwa = (): boolean =>
  window.matchMedia('(display-mode: standalone)').matches &&
  CSS.supports('-webkit-touch-callout: none');

export function installIosPwaViewportHeight(): void {
  if (!isStandaloneIosPwa()) return;

  let frame = 0;
  let settleTimer = 0;
  let fullHeight = 0;
  let viewportWidth = window.innerWidth;

  const updateHeight = () => {
    frame = 0;
    const viewport = window.visualViewport;
    const visibleHeight = viewport?.height ?? window.innerHeight;
    const visibleBottom = visibleHeight + (viewport?.offsetTop ?? 0);

    if (window.innerWidth !== viewportWidth) {
      viewportWidth = window.innerWidth;
      fullHeight = visibleBottom;
    }

    const keyboardOpen = fullHeight - visibleHeight > MIN_KEYBOARD_HEIGHT;
    if (!keyboardOpen) fullHeight = Math.max(fullHeight, visibleBottom);

    const height = keyboardOpen ? visibleBottom : fullHeight;
    document.documentElement.style.setProperty(IOS_PWA_VIEWPORT_HEIGHT, `${Math.round(height)}px`);
  };

  const scheduleUpdate = () => {
    if (frame) cancelAnimationFrame(frame);
    frame = requestAnimationFrame(updateHeight);

    window.clearTimeout(settleTimer);
    settleTimer = window.setTimeout(updateHeight, 350);
  };

  updateHeight();
  window.addEventListener('resize', scheduleUpdate);
  window.addEventListener('orientationchange', scheduleUpdate);
  window.visualViewport?.addEventListener('resize', scheduleUpdate);
  window.visualViewport?.addEventListener('scroll', scheduleUpdate);
  document.addEventListener('focusin', scheduleUpdate);
  document.addEventListener('focusout', scheduleUpdate);
}
