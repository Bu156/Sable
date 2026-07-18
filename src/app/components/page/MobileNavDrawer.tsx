import type { ReactNode } from 'react';
import { useCallback, useLayoutEffect, useRef, useState } from 'react';
import { animate, motion, useMotionValue } from 'framer-motion';
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

const SPRING = { type: 'spring', stiffness: 400, damping: 40 } as const;
const OPEN_FRACTION = 0.35;
const VELOCITY_THRESHOLD = 0.4;
const DIRECTION_DEADZONE = 10;

type MobileNavDrawerProps = {
  nav: ReactNode;
  children: ReactNode;
};

const clamp = (value: number, min: number, max: number): number =>
  Math.min(Math.max(value, min), max);

/** Sliding mobile drawer: the list and active room are adjacent panels; dragging
 * reveals the list and commits the route on release. */
export function MobileNavDrawer({ nav, children }: MobileNavDrawerProps) {
  const [mobileGestures] = useSetting(settingsAtom, 'mobileGestures');
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
  const navPanelRef = useRef<HTMLDivElement | null>(null);
  const contentPanelRef = useRef<HTMLDivElement | null>(null);
  const [width, setWidth] = useState(0);
  const x = useMotionValue(0);
  const draggingRef = useRef(false);
  const prevContentOpenRef = useRef(contentOpen);

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
    if (routeChanged && width > 0) {
      animate(x, target, SPRING);
    } else {
      x.jump(target);
    }
  }, [contentOpen, width, x]);

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
            animate(x, -width, SPRING);
          }
          cancel();
          return;
        }
        if (active) {
          // Take over any settling spring; offset is seeded from the live position.
          if (first) x.stop();
          draggingRef.current = true;
          x.set(clamp(ox, -width, 0));
          return;
        }
        draggingRef.current = false;
        const opened = width + ox > width * OPEN_FRACTION || (vx > VELOCITY_THRESHOLD && dx > 0);
        animate(x, opened ? 0 : -width, SPRING);
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
    // pointer.touch: use touch events so a WebView pointercancel on the pan-y surface
    // doesn't abort the drag mid-gesture. capture:false avoids fighting the nested wrapper.
    {
      axis: 'x',
      filterTaps: true,
      pointer: { touch: true, capture: false },
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
      <motion.div style={{ x, display: 'flex', height: '100%', willChange: 'transform' }}>
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
          {nav}
        </div>
        <div
          ref={contentPanelRef}
          style={{
            width,
            height: '100%',
            flexShrink: 0,
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden',
          }}
        >
          {children}
        </div>
      </motion.div>
    </div>
  );
}
