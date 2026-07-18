import type { ReactNode } from 'react';
import { useCallback, useLayoutEffect, useRef, useState } from 'react';
import { motion, useMotionValue, useReducedMotion } from 'framer-motion';
import { useDrag } from '@use-gesture/react';
import { useAtomValue, useSetAtom } from 'jotai';
import { matchPath, useLocation, useNavigate } from 'react-router-dom';
import { useSetting } from '$state/hooks/settings';
import { settingsAtom } from '$state/settings';
import { lastVisitedRoomAtom } from '$state/room/lastRoom';
import {
  DIRECT_PATH,
  DIRECT_ROOM_PATH,
  EXPLORE_PATH,
  HOME_PATH,
  HOME_ROOM_PATH,
  INBOX_PATH,
  SPACE_PATH,
  SPACE_ROOM_PATH,
} from '$pages/paths';
import { resolveSection } from '$pages/pathUtils';

const SLIDE_MS = 300;
const SLIDE_EASE = 'cubic-bezier(0.32, 0.72, 0, 1)';
const OPEN_FRACTION = 0.35;
const VELOCITY_THRESHOLD = 0.4;
const DIRECTION_DEADZONE = 10;

type MobileNavDrawerProps = {
  nav: ReactNode;
  rail?: ReactNode;
  bottomNav?: ReactNode;
  children: ReactNode;
};

const clamp = (value: number, min: number, max: number): number =>
  Math.min(Math.max(value, min), max);

/** Sliding mobile drawer: the list and active room are adjacent panels; dragging
 * reveals the list and commits the route on release. */
export function MobileNavDrawer({ nav, rail, bottomNav, children }: MobileNavDrawerProps) {
  const [mobileGestures] = useSetting(settingsAtom, 'mobileGestures');
  const reduceMotion = useReducedMotion();
  const location = useLocation();
  const navigate = useNavigate();
  const setLastRoom = useSetAtom(lastVisitedRoomAtom);
  const lastRoom = useAtomValue(lastVisitedRoomAtom);

  const roomMatch =
    matchPath({ path: HOME_ROOM_PATH, end: false }, location.pathname) ??
    matchPath({ path: DIRECT_ROOM_PATH, end: false }, location.pathname) ??
    matchPath({ path: SPACE_ROOM_PATH, end: false }, location.pathname);

  // The bare section route is the list; anything deeper is content revealed by dragging.
  const listView =
    matchPath({ path: HOME_PATH, end: true }, location.pathname) !== null ||
    matchPath({ path: DIRECT_PATH, end: true }, location.pathname) !== null ||
    matchPath({ path: SPACE_PATH, end: true }, location.pathname) !== null ||
    matchPath({ path: EXPLORE_PATH, end: true }, location.pathname) !== null ||
    matchPath({ path: INBOX_PATH, end: true }, location.pathname) !== null;
  const contentOpen = !listView;

  const viewportRef = useRef<HTMLDivElement | null>(null);
  const sliderRef = useRef<HTMLDivElement | null>(null);
  const navPanelRef = useRef<HTMLDivElement | null>(null);
  const contentPanelRef = useRef<HTMLDivElement | null>(null);
  const [width, setWidth] = useState(0);
  const x = useMotionValue(0);
  const draggingRef = useRef(false);
  const prevContentOpenRef = useRef(contentOpen);
  const openRafRef = useRef(0);
  const [deferContent, setDeferContent] = useState(false);
  const [prevOpen, setPrevOpen] = useState(contentOpen);

  // Detect the open transition during render so the room isn't rendered in the slide's commit.
  if (contentOpen !== prevOpen) {
    setPrevOpen(contentOpen);
    setDeferContent(contentOpen && !reduceMotion);
  }

  // Compositor transition for the settle animation; off = finger-1:1 during drag.
  const applyTransition = useCallback((animated: boolean) => {
    const el = sliderRef.current;
    if (el) el.style.transition = animated ? `transform ${SLIDE_MS}ms ${SLIDE_EASE}` : 'none';
  }, []);

  const settle = useCallback(
    (target: number) => {
      if (reduceMotion) {
        applyTransition(false);
        x.jump(target);
        return;
      }
      applyTransition(true);
      x.set(target);
    },
    [reduceMotion, x, applyTransition]
  );

  // Release the deferred room after the slide is committed to the compositor.
  useLayoutEffect(() => {
    if (!deferContent) return undefined;
    cancelAnimationFrame(openRafRef.current);
    openRafRef.current = requestAnimationFrame(() =>
      requestAnimationFrame(() => setDeferContent(false))
    );
    return () => cancelAnimationFrame(openRafRef.current);
  }, [deferContent]);

  useLayoutEffect(() => {
    const el = viewportRef.current;
    if (!el) return undefined;
    const update = () => setWidth(el.clientWidth);
    update();
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // Keep the offscreen panel out of the focus order and accessibility tree.
  useLayoutEffect(() => {
    navPanelRef.current?.toggleAttribute('inert', contentOpen);
    contentPanelRef.current?.toggleAttribute('inert', !contentOpen);
  }, [contentOpen]);

  // Sync panel position to the route: animate on route change, jump on mount/resize.
  useLayoutEffect(() => {
    const routeChanged = prevContentOpenRef.current !== contentOpen;
    prevContentOpenRef.current = contentOpen;
    if (draggingRef.current) return;
    const target = contentOpen ? -width : 0;
    if (routeChanged && width > 0 && !reduceMotion) {
      settle(target);
    } else {
      applyTransition(false);
      x.jump(target);
    }
  }, [contentOpen, width, x, settle, applyTransition, reduceMotion]);

  const goToList = useCallback(() => {
    const section = resolveSection(location.pathname);
    if (!section) return;

    const id = roomMatch?.params.roomIdOrAlias;
    if (section.getRoomPath && id) {
      setLastRoom({ section: section.key, roomId: decodeURIComponent(id) });
    }

    navigate(section.listPath);
  }, [roomMatch, location.pathname, navigate, setLastRoom]);

  const goToRoom = useCallback(() => {
    const section = resolveSection(location.pathname);
    if (!section?.getRoomPath) return;
    // Scope the remembered room to its section so a DM never opens under /home/, etc.
    if (!lastRoom || lastRoom.section !== section.key) return;

    navigate(section.getRoomPath(lastRoom.roomId));
  }, [lastRoom, location.pathname, navigate]);

  const bind = useDrag(
    ({
      first,
      active,
      last,
      canceled,
      movement: [mx],
      offset: [ox],
      velocity: [vx],
      direction: [dx],
      event,
      cancel,
    }) => {
      if (canceled || !mobileGestures || width === 0) return;

      const target = event?.target;
      if (target instanceof HTMLElement && target.closest('[data-gestures="ignore"]')) {
        cancel();
        return;
      }

      if (contentOpen) {
        // Drawer owns the rightward reveal; yield leftward drags to in-room actions.
        if (mx < -DIRECTION_DEADZONE) {
          if (draggingRef.current) {
            draggingRef.current = false;
            settle(-width);
          }
          cancel();
          return;
        }
        if (active) {
          // Take over any settling animation; offset is seeded from the live position.
          if (first) {
            x.stop();
            applyTransition(false);
          }
          draggingRef.current = true;
          x.set(clamp(ox, -width, 0));
          return;
        }
        draggingRef.current = false;
        const opened = width + ox > width * OPEN_FRACTION || (vx > VELOCITY_THRESHOLD && dx > 0);
        settle(opened ? 0 : -width);
        if (opened) goToList();
        return;
      }

      // On the list: a leftward flick/drag reveals the last room via navigation.
      if (mx > DIRECTION_DEADZONE) {
        cancel();
        return;
      }
      if (last) {
        const wantRoom = -mx > width * OPEN_FRACTION || (vx > VELOCITY_THRESHOLD && dx < 0);
        if (wantRoom) goToRoom();
      }
    },
    // axis:'x' + touch-action:pan-y lets the browser keep native vertical scroll.
    {
      axis: 'x',
      filterTaps: true,
      pointer: { capture: false },
      from: () => [x.get(), 0],
    }
  );

  return (
    <div
      {...bind()}
      ref={viewportRef}
      style={{
        position: 'relative',
        overflow: 'hidden',
        display: 'flex',
        flexGrow: 1,
        height: '100%',
        width: '100%',
        touchAction: 'pan-y',
      }}
    >
      <motion.div
        ref={sliderRef}
        style={{ x, display: 'flex', height: '100%', willChange: 'transform' }}
      >
        <div
          ref={navPanelRef}
          style={{
            width,
            height: '100%',
            flexShrink: 0,
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden',
          }}
        >
          <div
            style={{
              flexGrow: 1,
              minHeight: 0,
              display: 'flex',
              flexDirection: 'row',
              overflow: 'hidden',
            }}
          >
            {rail && <div style={{ flexShrink: 0, display: 'flex', overflow: 'hidden' }}>{rail}</div>}
            <div style={{ flexGrow: 1, minWidth: 0, display: 'flex', overflow: 'hidden' }}>
              {nav}
            </div>
          </div>
          {bottomNav}
        </div>
        <div
          ref={contentPanelRef}
          style={{
            width,
            height: '100%',
            flexShrink: 0,
            display: 'flex',
            overflow: 'hidden',
          }}
        >
          {deferContent ? null : children}
        </div>
      </motion.div>
    </div>
  );
}
