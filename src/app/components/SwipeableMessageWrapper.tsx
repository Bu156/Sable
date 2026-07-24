import { useMotionValue, useTransform, motion, animate } from 'framer-motion';
import { useDrag } from '@use-gesture/react';
import type { ReactNode } from 'react';
import { useMemo, useRef, useState } from 'react';
import { useAtomValue } from 'jotai';
import { ArrowBendUpLeftIcon, PencilSimple, getPhosphorIconSize } from '$components/icons/phosphor';
import { haptic } from '$utils/haptics';
import { mobileOrTablet } from '$utils/user-agent';
import { RightSwipeAction, settingsAtom } from '$state/settings';

type SwipeActionMode = 'none' | 'reply' | 'edit';

function ActiveSwipeWrapper({
  children,
  onReply,
  onEdit,
}: {
  children: ReactNode;
  onReply: () => void;
  onEdit?: () => void;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const x = useMotionValue(0);
  const [actionMode, setActionMode] = useState<SwipeActionMode>('none');
  const actionModeRef = useRef<SwipeActionMode>('none');
  const iconOpacity = useTransform(x, [0, -12], [0, 1]);
  const bgOpacity = useTransform(x, [0, -15], [0, 1]);
  const gapWidth = useTransform(x, (val) => Math.abs(Math.min(0, val)));

  const bind = useDrag(
    ({ first, active, movement: [mx] }) => {
      if (first) x.stop();

      const width = containerRef.current?.clientWidth || 360;
      const replyThreshold = -Math.min(50, width * 0.2);
      const editThreshold = -Math.min(110, width * 0.38);

      if (active) {
        const val = mx < 0 ? mx : 0;
        const dragDist = Math.abs(val);
        const linearLimit = onEdit ? Math.min(100, width * 0.32) : Math.min(60, width * 0.18);
        let smoothedDist = dragDist;

        if (dragDist > linearLimit) {
          const excess = dragDist - linearLimit;
          const maxExcess = 45;
          // Smooth exponential ease-out deceleration so the swipe slows down gradually instead of stopping abruptly
          smoothedDist = linearLimit + maxExcess * (1 - Math.exp(-excess / 40));
        }
        x.set(-smoothedDist);

        let nextMode: SwipeActionMode = 'none';
        if (onEdit && mx < editThreshold) {
          nextMode = 'edit';
        } else if (mx < replyThreshold) {
          nextMode = 'reply';
        }

        if (nextMode !== actionModeRef.current) {
          actionModeRef.current = nextMode;
          setActionMode(nextMode);
          if (nextMode !== 'none') {
            haptic(nextMode === 'edit' ? 'medium' : 'selection');
          }
        }
      } else {
        const currentMode = actionModeRef.current;
        if (currentMode === 'edit' && onEdit) {
          onEdit();
        } else if (currentMode === 'reply') {
          onReply();
        }
        animate(x, 0, { type: 'spring', stiffness: 300, damping: 26 });
        actionModeRef.current = 'none';
        setActionMode('none');
      }
    },
    {
      axis: 'x',
      bounds: { right: 0 },
      rubberband: true,
      filterTaps: true,
      eventOptions: { passive: true },
    }
  );

  const IconComponent = actionMode === 'edit' ? PencilSimple : ArrowBendUpLeftIcon;
  const iconColor =
    actionMode === 'edit'
      ? 'var(--sable-primary-color, #6e56cf)'
      : actionMode === 'reply'
        ? 'var(--sable-surface-on-container, #ffffff)'
        : 'rgba(255, 255, 255, 0.6)';

  return (
    <div
      data-gestures="ignore"
      ref={containerRef}
      {...bind()}
      style={{ position: 'relative', touchAction: 'pan-y' }}
    >
      {/* Darkened backdrop for the revealed gap, anchored to the right edge */}
      <motion.div
        style={{
          position: 'absolute',
          top: 0,
          bottom: 0,
          right: 0,
          width: gapWidth,
          backgroundColor: 'rgba(0, 0, 0, 0.35)',
          opacity: bgOpacity,
          borderTopRightRadius: '8px',
          borderBottomRightRadius: '8px',
          zIndex: 0,
          pointerEvents: 'none',
        }}
      />

      <motion.div style={{ x, position: 'relative', zIndex: 2, willChange: 'transform' }}>
        {children}

        {/* Action icon pinned to the right edge of the sliding message */}
        <motion.div
          style={{
            position: 'absolute',
            top: 0,
            bottom: 0,
            left: '100%',
            width: '60px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1,
            pointerEvents: 'none',
            opacity: iconOpacity,
          }}
        >
          <IconComponent
            size={getPhosphorIconSize('toolbar')}
            style={{
              color: iconColor,
              transition: 'color 0.2s, transform 0.2s',
              transform: actionMode === 'edit' ? 'scale(1.2)' : 'scale(1)',
            }}
          />
        </motion.div>
      </motion.div>
    </div>
  );
}

export function SwipeableMessageWrapper({
  children,
  onReply,
  onEdit,
}: {
  children: ReactNode;
  onReply?: () => void;
  onEdit?: () => void;
}) {
  const settings = useAtomValue(settingsAtom);

  const isSwipeToReplyEnabled = useMemo(
    () =>
      settings.mobileGestures &&
      mobileOrTablet() &&
      settings.rightSwipeAction !== RightSwipeAction.Members,
    [settings.mobileGestures, settings.rightSwipeAction]
  );

  if (!isSwipeToReplyEnabled || !onReply) {
    return children;
  }

  return (
    <ActiveSwipeWrapper onReply={onReply} onEdit={onEdit}>
      {children}
    </ActiveSwipeWrapper>
  );
}
