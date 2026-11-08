// Viewport tracking (mobile on-screen keyboard) and scroll-follow helper.

export interface ScrollMetrics {
  scrollTop: number;
  clientHeight: number;
  scrollHeight: number;
}

/**
 * True when the scroller is at (or within `tolerancePx` of) the bottom, so new
 * output should keep it pinned there.
 */
export function shouldStick(m: ScrollMetrics, tolerancePx = 4): boolean {
  return m.scrollHeight - (m.scrollTop + m.clientHeight) <= tolerancePx;
}

/**
 * Sets `--vv-height` and `--vv-top` on the root element from `visualViewport`
 * (falls back to `window` resize), batched in `requestAnimationFrame`, and keeps
 * `inputLine` visible. Returns a disposer.
 */
export function installViewportTracking(
  root: HTMLElement = document.documentElement,
  inputLine?: HTMLElement | null,
): () => void {
  const vv = window.visualViewport ?? null;
  let pending = false;
  let frame = 0;

  const apply = (): void => {
    pending = false;
    const height = vv ? vv.height : window.innerHeight;
    const top = vv ? vv.offsetTop : 0;
    root.style.setProperty('--vv-height', `${height}px`);
    root.style.setProperty('--vv-top', `${top}px`);
    if (inputLine && typeof inputLine.scrollIntoView === 'function') {
      inputLine.scrollIntoView({ block: 'nearest' });
    }
  };

  const schedule = (): void => {
    if (pending) return;
    pending = true;
    frame = window.requestAnimationFrame(apply);
  };

  const targets: EventTarget[] = vv ? [vv] : [window];
  const events = vv ? ['resize', 'scroll'] : ['resize'];
  for (const t of targets) for (const e of events) t.addEventListener(e, schedule);
  apply();

  return () => {
    for (const t of targets) for (const e of events) t.removeEventListener(e, schedule);
    if (pending) window.cancelAnimationFrame(frame);
    pending = false;
  };
}
