import { useEffect, useRef } from 'react';
import { useLocation, useNavigationType } from 'react-router-dom';

/**
 * Global scroll-position save/restore.
 *
 * The browser normally restores scroll on BACK (POP navigation), but React
 * Router re-renders the whole app on every navigation, which can wipe the
 * scroll position. This component:
 *
 *   1. Saves the current scroll position to sessionStorage on every scroll
 *      (debounced via rAF).
 *   2. On POP (back button) navigation, restores the saved position
 *      BEFORE the page content is rendered, by setting window.scrollY in
 *      a microtask so the browser uses it as the initial value.
 *   3. On PUSH/REPLACE, scrolls to the top (existing behavior).
 *
 * This is a drop-in replacement for the simpler ScrollToTop component.
 */

const SCROLL_KEY_PREFIX = 'scroll_pos_v1:';

const safeSessionSet = (key: string, value: number) => {
  try {
    sessionStorage.setItem(key, String(value));
  } catch {
    // ignore quota / privacy mode
  }
};

const safeSessionGet = (key: string): number | null => {
  try {
    const raw = sessionStorage.getItem(key);
    if (raw == null) return null;
    const n = Number.parseInt(raw, 10);
    return Number.isFinite(n) && n >= 0 ? n : null;
  } catch {
    return null;
  }
};

const getScrollMetrics = () => {
  const scrollingEl = (document.scrollingElement || document.documentElement) as HTMLElement | null;
  const scrollTop = scrollingEl?.scrollTop
    ?? (window as any).pageYOffset
    ?? window.scrollY
    ?? 0;
  const scrollHeight = Math.max(
    scrollingEl?.scrollHeight || 0,
    document.body?.scrollHeight || 0,
    document.documentElement?.scrollHeight || 0
  );
  const clientHeight = scrollingEl?.clientHeight || window.innerHeight || 0;
  return { scrollTop, scrollHeight, clientHeight };
};

const ScrollToTop = () => {
  const { pathname, search } = useLocation();
  const navigationType = useNavigationType();
  const lastSavedRef = useRef(0);
  const rafRef = useRef<number | null>(null);
  const restoredKeyRef = useRef<string | null>(null);

  // The key under which we save the scroll position for the current URL.
  // We include search so that two search pages with different ?q= don't
  // share a scroll position.
  const fullPath = pathname + (search || '');
  const scrollKey = SCROLL_KEY_PREFIX + fullPath;

  // 1) On every mount, attach a scroll listener that saves the position
  //    for the CURRENT page (i.e. the page the user is on / leaving).
  useEffect(() => {
    const onScroll = () => {
      if (rafRef.current != null) return;
      rafRef.current = requestAnimationFrame(() => {
        rafRef.current = null;
        const { scrollTop } = getScrollMetrics();
        if (Math.abs(scrollTop - lastSavedRef.current) >= 1) {
          lastSavedRef.current = scrollTop;
          safeSessionSet(scrollKey, scrollTop);
        }
      });
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('touchmove', onScroll, { passive: true });
    return () => {
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('touchmove', onScroll);
      if (rafRef.current != null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
      // One final save on unmount (covers the React Router re-render
      // case where the listener is removed before navigation completes).
      const { scrollTop } = getScrollMetrics();
      safeSessionSet(scrollKey, scrollTop);
    };
  }, [scrollKey]);

  // 2) On navigation, either restore (POP) or scroll-to-top (PUSH/REPLACE).
  useEffect(() => {
    // Avoid running the restore path twice for the same key in the same render
    if (navigationType === 'POP') {
      // Restore: try to set window.scrollY synchronously so the browser
      // uses it as the initial value. Some browsers ignore programmatic
      // scrollTo before layout, so we also schedule a microtask + a
      // double-rAF for safety.
      const saved = safeSessionGet(scrollKey);
      if (saved != null && saved > 0 && restoredKeyRef.current !== scrollKey) {
        restoredKeyRef.current = scrollKey;
        // Set lastSavedRef so the scroll listener doesn't immediately
        // overwrite our restored position with 0.
        lastSavedRef.current = saved;
        const tryRestore = (attempt: number) => {
          window.scrollTo(0, saved);
          // If the document isn't tall enough yet, the browser clamps
          // scrollY to 0. Retry until the page has rendered enough.
          //
          // The retry window must outlast the route exit animation: with
          // <AnimatePresence mode="wait"> the returning page doesn't mount
          // until the product page finishes animating out (~300-500ms), so
          // a short budget would give up before the cached feed is on screen
          // and leave the user at the top. ~60 frames (~1s) covers it.
          if (attempt < 60) {
            const { scrollHeight, clientHeight } = getScrollMetrics();
            const scrollable = scrollHeight - clientHeight;
            if (scrollable < saved) {
              requestAnimationFrame(() => tryRestore(attempt + 1));
            }
          }
        };
        // Run on the next microtask + frame so React has flushed DOM.
        queueMicrotask(() => requestAnimationFrame(() => tryRestore(0)));
      }
    } else {
      // PUSH or REPLACE — start at the top.
      window.scrollTo(0, 0);
      lastSavedRef.current = 0;
    }
  }, [fullPath, navigationType, scrollKey]);

  return null;
};

export default ScrollToTop;
