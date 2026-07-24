import type { ReactNode } from 'react';
import {
  startTransition,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
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
import { MobileNavDrawerContext, type MobileSwipeTarget } from './MobileNavDrawerContext';
import { NoScrollbar } from './MobileNavDrawer.css';
import {
  classifyMobileGesture,
  getDrawerSettlePosition,
  type MobileGestureMode,
} from './mobileSwipeCoordinator';

type MobileNavDrawerProps = {
  nav: ReactNode;
  rail?: ReactNode;
  bottomNav?: ReactNode;
  children: ReactNode;
};

const DRAWER_EASE = 'cubic-bezier(0.32, 0.72, 0, 1)';
// Initial slope of DRAWER_EASE; matched against release speed so the slide picks up the
// finger's motion instead of starting from a standstill.
const DRAWER_EASE_INITIAL_SLOPE = 2.25;
const DRAWER_FULL_SLIDE_MS = 300;
const DRAWER_MIN_SLIDE_MS = 160;
const DRAWER_MAX_SLIDE_MS = 420;
const DRAWER_FLICK_SPEED = 0.05; // px/ms

const clamp = (value: number, min: number, max: number): number =>
  Math.min(Math.max(value, min), max);

type ActiveTouchGesture = {
  startX: number;
  startY: number;
  startPosition: number;
  lastX: number;
  lastTime: number;
  velocityX: number;
  mode: MobileGestureMode;
  message?: MobileSwipeTarget;
  chat?: MobileSwipeTarget;
};

/** Sliding mobile drawer with one touch coordinator and a GPU-transformed panel track. */
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
  const trackRef = useRef<HTMLDivElement | null>(null);
  const navPanelRef = useRef<HTMLDivElement | null>(null);
  const contentPanelRef = useRef<HTMLDivElement | null>(null);
  const [width, setWidth] = useState(0);
  const widthRef = useRef(0);
  const positionRef = useRef(0);

  const [panelIntent, setPanelIntent] = useState(contentOpen ? 1 : 0);
  const gestureRef = useRef<ActiveTouchGesture>();
  const messageTargetsRef = useRef(new WeakMap<HTMLElement, MobileSwipeTarget>());
  const chatTargetsRef = useRef(new WeakMap<HTMLElement, MobileSwipeTarget>());
  const settleTimeoutRef = useRef<number>();
  const programmaticTargetRef = useRef<number>();

  const setTrackPosition = useCallback((position: number) => {
    positionRef.current = position;
    const el = trackRef.current;
    if (!el) return;
    el.style.transition = 'none';
    el.style.transform = `translate3d(${position}px, 0, 0)`;
  }, []);

  // Reading the computed transform also flushes pending style, without which a settle
  // starting right after a drag frame would jump instead of interpolating.
  const readTrackPosition = useCallback((): number => {
    const el = trackRef.current;
    if (!el) return positionRef.current;
    const { transform } = getComputedStyle(el);
    if (!transform || transform === 'none') return positionRef.current;
    try {
      return new DOMMatrix(transform).m41;
    } catch {
      return positionRef.current;
    }
  }, []);

  // While a transition is in flight positionRef holds its target, not the visible position.
  const currentPosition = useCallback(
    () => (settleTimeoutRef.current === undefined ? positionRef.current : readTrackPosition()),
    [readTrackPosition]
  );

  const setTrackBoosted = useCallback((boosted: boolean) => {
    const el = trackRef.current;
    if (el) el.style.willChange = boosted ? 'transform' : 'auto';
  }, []);

  const cancelSettle = useCallback(() => {
    if (settleTimeoutRef.current === undefined) return;
    window.clearTimeout(settleTimeoutRef.current);
    settleTimeoutRef.current = undefined;
    setTrackPosition(readTrackPosition());
  }, [readTrackPosition, setTrackPosition]);

  const settleToPanel = useCallback(
    (targetPosition: number, velocityX: number, onComplete?: () => void) => {
      const el = trackRef.current;
      if (!el) return;

      window.clearTimeout(settleTimeoutRef.current);
      settleTimeoutRef.current = undefined;

      const startPosition = readTrackPosition();
      const distance = targetPosition - startPosition;

      if (reduceMotion || Math.abs(distance) <= 1) {
        setTrackPosition(targetPosition);
        setTrackBoosted(false);
        onComplete?.();
        return;
      }

      // A flick against the committed direction must not shorten the glide.
      const speed = Math.sign(velocityX) === Math.sign(distance) ? Math.abs(velocityX) : 0;
      const duration =
        speed > DRAWER_FLICK_SPEED
          ? clamp(
              (DRAWER_EASE_INITIAL_SLOPE * Math.abs(distance)) / speed,
              DRAWER_MIN_SLIDE_MS,
              DRAWER_MAX_SLIDE_MS
            )
          : clamp(
              (Math.abs(distance) / Math.max(widthRef.current, 1)) * DRAWER_FULL_SLIDE_MS,
              DRAWER_MIN_SLIDE_MS,
              DRAWER_FULL_SLIDE_MS
            );

      setTrackBoosted(true);
      positionRef.current = targetPosition;
      el.style.transition = `transform ${Math.round(duration)}ms ${DRAWER_EASE}`;
      el.style.transform = `translate3d(${targetPosition}px, 0, 0)`;

      settleTimeoutRef.current = window.setTimeout(() => {
        settleTimeoutRef.current = undefined;
        setTrackBoosted(false);
        onComplete?.();
      }, Math.round(duration));
    },
    [reduceMotion, readTrackPosition, setTrackBoosted, setTrackPosition]
  );

  const registerMessageSwipe = useCallback((element: HTMLElement, target: MobileSwipeTarget) => {
    messageTargetsRef.current.set(element, target);
    return () => {
      if (messageTargetsRef.current.get(element) === target) {
        messageTargetsRef.current.delete(element);
      }
    };
  }, []);

  const registerChatSwipe = useCallback((element: HTMLElement, target: MobileSwipeTarget) => {
    chatTargetsRef.current.set(element, target);
    return () => {
      if (chatTargetsRef.current.get(element) === target) {
        chatTargetsRef.current.delete(element);
      }
    };
  }, []);

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

  const openContent = useCallback(
    (path: string) => {
      const viewport = viewportRef.current;
      if (!viewport || width === 0) {
        startTransition(() => navigate(path));
        return;
      }

      setRoomArmed(true);
      programmaticTargetRef.current = -width;

      // Start the exact same settle used after a swipe immediately, while the
      // selected room renders concurrently in the panel being revealed.
      settleToPanel(-width, 0, () => {
        if (programmaticTargetRef.current === -width) {
          programmaticTargetRef.current = undefined;
        }
        setPanelIntent(1);
      });
      startTransition(() => navigate(path));
    },
    [navigate, settleToPanel, width]
  );

  useLayoutEffect(() => {
    const el = viewportRef.current;
    if (!el) return undefined;
    const update = () => {
      const nextWidth = el.clientWidth;
      const previousWidth = widthRef.current;
      const nextPosition =
        previousWidth > 0
          ? (positionRef.current / previousWidth) * nextWidth
          : contentOpen
            ? -nextWidth
            : 0;
      widthRef.current = nextWidth;
      setTrackPosition(nextPosition);
      setWidth(nextWidth);
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => observer.disconnect();
  }, [contentOpen, setTrackPosition]);

  useLayoutEffect(() => {
    navPanelRef.current?.toggleAttribute('inert', panelIntent === 1);
    contentPanelRef.current?.toggleAttribute('inert', panelIntent === 0);
  }, [panelIntent]);

  useLayoutEffect(() => {
    const el = viewportRef.current;
    if (!el || width === 0) return;
    const targetPosition = contentOpen ? -width : 0;

    if (programmaticTargetRef.current === targetPosition) return;

    if (Math.abs(positionRef.current - targetPosition) > 5) {
      settleToPanel(targetPosition, 0, () => setPanelIntent(contentOpen ? 1 : 0));
    } else {
      setPanelIntent(contentOpen ? 1 : 0);
    }
  }, [contentOpen, settleToPanel, width]);

  const commitPanel = useCallback(
    (roomVisible: boolean) => {
      if (width === 0) return;

      setTrackPosition(roomVisible ? -width : 0);
      setPanelIntent(roomVisible ? 1 : 0);

      if (roomVisible === contentOpen) return;

      if (roomVisible) {
        const section = resolveSection(location.pathname);
        if (section?.getRoomPath) {
          const lastRoomId = lastRoom?.[section.key];
          if (lastRoomId) {
            startTransition(() => navigate(section.getRoomPath!(lastRoomId)));
            return;
          }
        }
        settleToPanel(0, 0);
        setPanelIntent(0);
        return;
      }

      const section = resolveSection(location.pathname);
      if (!section) return;
      if (section.getRoomPath && matchedRoomId && isRoomRoute) {
        setLastRoom((prev) => ({ ...prev, [section.key]: matchedRoomId }));
      }
      startTransition(() => navigate(section.listPath));
    },
    [
      contentOpen,
      isRoomRoute,
      lastRoom,
      location.pathname,
      matchedRoomId,
      navigate,
      settleToPanel,
      setLastRoom,
      setTrackPosition,
      width,
    ]
  );

  const finishGesture = useCallback(
    (cancelled: boolean) => {
      const gesture = gestureRef.current;
      gestureRef.current = undefined;
      if (!gesture) return;

      const distanceX = gesture.lastX - gesture.startX;
      if (gesture.mode === 'message') {
        if (cancelled) gesture.message?.cancel();
        else gesture.message?.end({ distanceX, velocityX: gesture.velocityX });
        return;
      }
      if (gesture.mode === 'chat') {
        if (cancelled) gesture.chat?.cancel();
        else gesture.chat?.end({ distanceX, velocityX: gesture.velocityX });
        return;
      }
      if (gesture.mode !== 'drawer' || width === 0) return;

      const targetPosition = getDrawerSettlePosition({
        startPosition: gesture.startPosition,
        distanceX,
        velocityX: gesture.velocityX,
        width,
        cancelled,
      });

      settleToPanel(targetPosition, gesture.velocityX, () =>
        commitPanel(targetPosition === -width)
      );
    },
    [commitPanel, settleToPanel, width]
  );

  useEffect(() => {
    return () => {
      window.clearTimeout(settleTimeoutRef.current);
      const gesture = gestureRef.current;
      gestureRef.current = undefined;
      gesture?.message?.cancel();
      gesture?.chat?.cancel();
    };
  }, []);

  const contextValue = useMemo(
    () => ({ openContent, registerChatSwipe, registerMessageSwipe }),
    [openContent, registerChatSwipe, registerMessageSwipe]
  );

  const drawer = (
    <div
      ref={viewportRef}
      data-testid="mobile-nav-drawer-viewport"
      onTouchStartCapture={(event) => {
        const viewport = viewportRef.current;
        const touch = event.touches[0];
        if (!mobileGestures || !viewport || !touch) return;
        if (event.touches.length !== 1) {
          finishGesture(true);
          return;
        }

        const target = event.target instanceof Element ? event.target : event.currentTarget;
        const messageElement = target.closest<HTMLElement>('[data-message-swipe]');
        const chatElement = target.closest<HTMLElement>('[data-chat-swipe]');
        const ignoredElement = target.closest<HTMLElement>('[data-gestures="ignore"]');
        const message = messageElement ? messageTargetsRef.current.get(messageElement) : undefined;
        const chat = chatElement ? chatTargetsRef.current.get(chatElement) : undefined;
        const blocked = ignoredElement !== null && ignoredElement !== messageElement;

        gestureRef.current = {
          startX: touch.clientX,
          startY: touch.clientY,
          startPosition: currentPosition(),
          lastX: touch.clientX,
          lastTime: event.timeStamp,
          velocityX: 0,
          mode: blocked ? 'blocked' : 'pending',
          message,
          chat,
        };
        if (positionRef.current > -width && canOpenRoom) setRoomArmed(true);
      }}
      onTouchMoveCapture={(event) => {
        const viewport = viewportRef.current;
        const gesture = gestureRef.current;
        const touch = event.touches[0];
        if (!viewport || !gesture || !touch || gesture.mode === 'blocked') return;

        const distanceX = touch.clientX - gesture.startX;
        const distanceY = touch.clientY - gesture.startY;
        const elapsed = event.timeStamp - gesture.lastTime;
        if (elapsed > 0) {
          gesture.velocityX = (touch.clientX - gesture.lastX) / elapsed;
          gesture.lastX = touch.clientX;
          gesture.lastTime = event.timeStamp;
        }

        if (gesture.mode === 'pending') {
          gesture.mode = classifyMobileGesture({
            distanceX,
            distanceY,
            startPosition: currentPosition(),
            width,
            canOpenRoom,
            hasMessage: gesture.message !== undefined,
            hasChat: gesture.chat !== undefined,
          });
          if (gesture.mode === 'drawer' || gesture.mode === 'message' || gesture.mode === 'chat') {
            const wasSettling = settleTimeoutRef.current !== undefined;
            cancelSettle();
            programmaticTargetRef.current = undefined;
            if (wasSettling) gesture.startPosition = positionRef.current - distanceX;
            if (gesture.mode === 'drawer') setTrackBoosted(true);
          }
        }

        if (gesture.mode === 'drawer') {
          setTrackPosition(Math.max(-width, Math.min(0, gesture.startPosition + distanceX)));
        } else if (gesture.mode === 'message') {
          gesture.message?.move(distanceX);
        } else if (gesture.mode === 'chat') {
          gesture.chat?.move(distanceX);
        }
      }}
      onTouchEndCapture={() => finishGesture(false)}
      onTouchCancelCapture={() => finishGesture(true)}
      style={{
        display: 'flex',
        flexGrow: 1,
        height: '100%',
        width: '100%',
        // `clip`, not `hidden`: hidden keeps a scrollport, so a focus or scrollIntoView on
        // the revealed panel scrolls it a full panel width out of frame, permanently.
        overflow: 'clip',
        touchAction: 'pan-y',
      }}
    >
      <div
        ref={trackRef}
        style={{
          display: 'flex',
          width: '200%',
          height: '100%',
          flexShrink: 0,
          transform: 'translate3d(0, 0, 0)',
        }}
      >
        <div
          ref={navPanelRef}
          className={NoScrollbar}
          style={{
            width: '50%',
            flexBasis: '50%',
            height: '100%',
            flexShrink: 0,
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
            {rail && (
              <div style={{ flexShrink: 0, display: 'flex', overflow: 'hidden' }}>{rail}</div>
            )}
            <div style={{ flexGrow: 1, minWidth: 0, display: 'flex', overflow: 'hidden' }}>
              {nav}
            </div>
          </div>
          {bottomNav}
        </div>
        <div
          ref={contentPanelRef}
          className={NoScrollbar}
          style={{
            width: '50%',
            flexBasis: '50%',
            height: '100%',
            flexShrink: 0,
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
    </div>
  );

  return (
    <MobileNavDrawerContext.Provider value={contextValue}>{drawer}</MobileNavDrawerContext.Provider>
  );
}
