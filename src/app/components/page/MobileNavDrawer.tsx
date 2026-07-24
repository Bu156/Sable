import type { ReactNode } from 'react';
import { startTransition, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useAtomValue, useSetAtom } from 'jotai';
import { matchPath, useLocation, useNavigate } from 'react-router-dom';
import { useSetting } from '$state/hooks/settings';
import { settingsAtom } from '$state/settings';
import { lastVisitedRoomAtom } from '$state/room/lastRoom';
import { useReducedMotion } from 'framer-motion';
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
import { isRoomAlias, isRoomId } from '$utils/matrix';
import { PersistentRoomHost } from './PersistentRoomHost';

type MobileNavDrawerProps = {
  nav: ReactNode;
  rail?: ReactNode;
  bottomNav?: ReactNode;
  children: ReactNode;
};

/** Sliding mobile drawer: the list and active room are adjacent snap panels;
 * native scrolling reveals the other panel and commits the route after settling. */
export function MobileNavDrawer({ nav, rail, bottomNav, children }: MobileNavDrawerProps) {
  const [mobileGestures] = useSetting(settingsAtom, 'mobileGestures');
  const reduceMotion = useReducedMotion();
  const location = useLocation();
  const navigate = useNavigate();
  const setLastRoom = useSetAtom(lastVisitedRoomAtom);
  const lastRoom = useAtomValue(lastVisitedRoomAtom);

  const openableSection = resolveSection(location.pathname);
  const canOpenRoom = Boolean(
    openableSection && openableSection.getRoomPath && lastRoom?.[openableSection.key]
  );

  const roomMatch =
    matchPath({ path: HOME_ROOM_PATH, end: false }, location.pathname) ??
    matchPath({ path: DIRECT_ROOM_PATH, end: false }, location.pathname) ??
    matchPath({ path: SPACE_ROOM_PATH, end: false }, location.pathname);
  const matchedRoomId = roomMatch?.params.roomIdOrAlias
    ? decodeURIComponent(roomMatch.params.roomIdOrAlias)
    : undefined;
  // `:roomIdOrAlias` also matches non-room segments like `create`, `search`, and `lobby`.
  // Only treat it as a room when it is a real Matrix ID or alias.
  const isRoomRoute = !!matchedRoomId && (isRoomId(matchedRoomId) || isRoomAlias(matchedRoomId));

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

  const [panelIntent, setPanelIntent] = useState(contentOpen ? 1 : 0);
  const userScrollRef = useRef(false);
  const touchActiveRef = useRef(false);
  const scrollEndTimerRef = useRef<number>();

  const [roomArmed, setRoomArmed] = useState(() => isRoomRoute || canOpenRoom);
  useEffect(() => {
    if (isRoomRoute || canOpenRoom) {
      setRoomArmed(true);
      return undefined;
    }
    if (roomArmed) return undefined;
    const ric = window.requestIdleCallback ?? ((cb: () => void) => window.setTimeout(cb, 200));
    const cic = window.cancelIdleCallback ?? window.clearTimeout;
    const handle = ric(() => setRoomArmed(true));
    return () => cic(handle as number);
  }, [isRoomRoute, canOpenRoom, roomArmed]);

  useLayoutEffect(() => {
    const el = viewportRef.current;
    if (!el) return undefined;
    const update = () => setWidth(el.clientWidth);
    update();
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  useLayoutEffect(() => {
    setPanelIntent(contentOpen ? 1 : 0);
  }, [contentOpen]);

  useLayoutEffect(() => {
    navPanelRef.current?.toggleAttribute('inert', panelIntent === 1);
    contentPanelRef.current?.toggleAttribute('inert', panelIntent === 0);
  }, [panelIntent]);

  useLayoutEffect(() => {
    const el = viewportRef.current;
    if (!el || width === 0) return;
    const targetLeft = contentOpen ? width : 0;

    userScrollRef.current = false;
    touchActiveRef.current = false;
    window.clearTimeout(scrollEndTimerRef.current);
    if (Math.abs(el.scrollLeft - targetLeft) > 5) {
      el.scrollTo({ left: targetLeft, behavior: reduceMotion ? 'auto' : 'smooth' });
    }
  }, [contentOpen, width, reduceMotion]);

  const finishUserScroll = useCallback(() => {
    const viewport = viewportRef.current;
    if (!viewport || !userScrollRef.current || width === 0) return;

    userScrollRef.current = false;
    const roomVisible = viewport.scrollLeft >= width / 2;
    setPanelIntent(roomVisible ? 1 : 0);

    if (roomVisible !== contentOpen) {
      if (roomVisible) {
        const section = resolveSection(location.pathname);
        if (section?.getRoomPath) {
          const lastRoomId = lastRoom?.[section.key];
          if (lastRoomId) {
            startTransition(() => navigate(section.getRoomPath!(lastRoomId)));
            return;
          }
        }
        viewport.scrollTo({ left: 0, behavior: reduceMotion ? 'auto' : 'smooth' });
        setPanelIntent(0);
      } else {
        const section = resolveSection(location.pathname);
        if (section) {
          if (section.getRoomPath && matchedRoomId && isRoomRoute) {
            setLastRoom((prev) => ({ ...prev, [section.key]: matchedRoomId }));
          }
          startTransition(() => navigate(section.listPath));
        }
      }
    }
  }, [
    contentOpen,
    isRoomRoute,
    lastRoom,
    location.pathname,
    matchedRoomId,
    navigate,
    reduceMotion,
    setLastRoom,
    width,
  ]);

  const scheduleScrollEnd = useCallback(
    (delay = 120) => {
      window.clearTimeout(scrollEndTimerRef.current);
      scrollEndTimerRef.current = window.setTimeout(finishUserScroll, delay);
    },
    [finishUserScroll]
  );

  useEffect(() => {
    return () => window.clearTimeout(scrollEndTimerRef.current);
  }, []);

  const allowScroll = mobileGestures && (canOpenRoom || contentOpen);

  return (
    <div
      ref={viewportRef}
      className="no-scrollbar"
      onTouchStart={() => {
        userScrollRef.current = true;
        touchActiveRef.current = true;
        window.clearTimeout(scrollEndTimerRef.current);
      }}
      onScroll={() => {
        if (!userScrollRef.current || width === 0) return;
        if (!touchActiveRef.current) scheduleScrollEnd();
      }}
      onTouchEnd={() => {
        touchActiveRef.current = false;
        scheduleScrollEnd(180);
      }}
      onTouchCancel={() => {
        touchActiveRef.current = false;
        scheduleScrollEnd();
      }}
      style={{
        display: 'flex',
        flexGrow: 1,
        height: '100%',
        width: '100%',
        overflowX: allowScroll ? 'auto' : 'hidden',
        overflowY: 'hidden',
        overscrollBehaviorX: 'none',
        scrollSnapType: 'x mandatory',
        WebkitOverflowScrolling: 'touch',
      }}
    >
      <style>{`
        .no-scrollbar::-webkit-scrollbar {
          display: none;
        }
        .no-scrollbar {
          -ms-overflow-style: none;
          scrollbar-width: none;
        }
      `}</style>
      <div
        ref={navPanelRef}
        className="no-scrollbar"
        style={{
          width: '100%',
          flexBasis: '100%',
          height: '100%',
          flexShrink: 0,
          scrollSnapAlign: 'start',
          scrollSnapStop: 'always',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          transform: 'translateZ(0)',
          backfaceVisibility: 'hidden',
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
          <div style={{ flexGrow: 1, minWidth: 0, display: 'flex', overflow: 'hidden' }}>{nav}</div>
        </div>
        {bottomNav}
      </div>
      <div
        ref={contentPanelRef}
        className="no-scrollbar"
        style={{
          width: '100%',
          flexBasis: '100%',
          height: '100%',
          flexShrink: 0,
          scrollSnapAlign: 'start',
          scrollSnapStop: 'always',
          display: 'flex',
          overflow: 'hidden',
          transform: 'translateZ(0)',
          backfaceVisibility: 'hidden',
        }}
      >
        {isRoomRoute ? (
          <PersistentRoomHost inactive={panelIntent === 0} />
        ) : listView ? (
          roomArmed ? (
            <PersistentRoomHost inactive={panelIntent === 0} />
          ) : null
        ) : (
          children
        )}
      </div>
    </div>
  );
}
