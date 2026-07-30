import type { ReactNode } from 'react';
import { useRef } from 'react';
import { animate, motion, useMotionValue } from 'framer-motion';
import { isMobileOrTablet } from '$utils/platform';

const SETTLE_MS = 220;
const LOCK_THRESHOLD_PX = 8;
const COMMIT_FRACTION = 0.22;
const VELOCITY_THRESHOLD = 0.45; // px per ms

const getViewportWidth = () => document.documentElement.clientWidth || window.innerWidth;

type GestureMode = 'pending' | 'vertical' | 'horizontal' | 'blocked';

type ActiveGesture = {
  startX: number;
  startY: number;
  lastX: number;
  lastTime: number;
  velocityX: number;
  mode: GestureMode;
  lockOffset: number;
};

interface SwipeableOverlayWrapperProps {
  children: ReactNode;
  onClose: () => void;
  direction: 'left' | 'right' | 'both';
}

export function SwipeableOverlayWrapper({
  children,
  onClose,
  direction,
}: SwipeableOverlayWrapperProps) {
  const x = useMotionValue(0);
  const gestureRef = useRef<ActiveGesture>();
  const closeCommittedRef = useRef(false);

  const acceptsLeft = direction !== 'right';
  const acceptsRight = direction !== 'left';

  const clampOffset = (val: number, viewportWidth: number) => {
    let v = val;
    if (!acceptsLeft) v = Math.max(0, v);
    if (!acceptsRight) v = Math.min(0, v);
    return Math.max(-viewportWidth, Math.min(viewportWidth, v));
  };

  const finish = (commitEligible: boolean) => {
    const gesture = gestureRef.current;
    gestureRef.current = undefined;
    if (!gesture || gesture.mode !== 'horizontal') return;

    if (commitEligible) {
      const viewportWidth = getViewportWidth();
      const val = x.get();
      const swipedLeft =
        acceptsLeft &&
        val < 0 &&
        (val <= -viewportWidth * COMMIT_FRACTION || gesture.velocityX <= -VELOCITY_THRESHOLD);
      const swipedRight =
        acceptsRight &&
        val > 0 &&
        (val >= viewportWidth * COMMIT_FRACTION || gesture.velocityX >= VELOCITY_THRESHOLD);

      if (swipedLeft || swipedRight) {
        closeCommittedRef.current = true;
        const target = swipedLeft ? -viewportWidth : viewportWidth;
        void animate(x, target, { duration: SETTLE_MS / 1000, ease: 'easeOut' }).then(() => {
          if (!closeCommittedRef.current) return;
          onClose();
          closeCommittedRef.current = false;
          animate(x, 0, { duration: SETTLE_MS / 1000, ease: 'easeOut' });
        });
        return;
      }
    }

    animate(x, 0, { duration: SETTLE_MS / 1000, ease: 'easeOut' });
  };

  if (!isMobileOrTablet()) {
    return (
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          flexGrow: 1,
          height: '100%',
          width: '100%',
        }}
      >
        {children}
      </div>
    );
  }

  return (
    <div
      onTouchStart={(event) => {
        if (closeCommittedRef.current) return;
        if (event.touches.length !== 1) {
          finish(false);
          return;
        }
        const touch = event.touches[0];
        if (!touch) return;
        const blocked =
          event.target instanceof HTMLElement &&
          event.target.closest('[data-gestures="ignore"]') !== null;
        gestureRef.current = {
          startX: touch.clientX,
          startY: touch.clientY,
          lastX: touch.clientX,
          lastTime: event.timeStamp,
          velocityX: 0,
          mode: blocked ? 'blocked' : 'pending',
          lockOffset: 0,
        };
      }}
      onTouchMove={(event) => {
        const gesture = gestureRef.current;
        const touch = event.touches[0];
        if (!gesture || !touch || gesture.mode === 'blocked' || gesture.mode === 'vertical') {
          return;
        }

        const distanceX = touch.clientX - gesture.startX;
        const distanceY = touch.clientY - gesture.startY;
        const elapsed = event.timeStamp - gesture.lastTime;
        if (elapsed > 0) {
          gesture.velocityX = (touch.clientX - gesture.lastX) / elapsed;
          gesture.lastX = touch.clientX;
          gesture.lastTime = event.timeStamp;
        }

        if (gesture.mode === 'pending') {
          if (Math.max(Math.abs(distanceX), Math.abs(distanceY)) < LOCK_THRESHOLD_PX) return;
          if (Math.abs(distanceY) >= Math.abs(distanceX)) {
            gesture.mode = 'vertical';
            return;
          }
          gesture.mode = 'horizontal';
          // Take over any settling spring; offset is seeded from the live position.
          x.stop();
          gesture.lockOffset = x.get();
        }

        x.set(clampOffset(gesture.lockOffset + distanceX, getViewportWidth()));
      }}
      onTouchEnd={() => finish(true)}
      onTouchCancel={() => finish(false)}
      style={{
        overflow: 'hidden',
        display: 'flex',
        flexDirection: 'column',
        flexGrow: 1,
        height: '100%',
        width: '100%',
        touchAction: 'pan-y',
        overscrollBehaviorX: 'none',
      }}
    >
      <motion.div
        style={{
          x,
          display: 'flex',
          flexDirection: 'column',
          flexGrow: 1,
          height: '100%',
          willChange: 'transform',
        }}
      >
        {children}
      </motion.div>
    </div>
  );
}
