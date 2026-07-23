import { type RefObject, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, animate, motion, useMotionValue, useReducedMotion } from 'framer-motion';
import { useDrag } from '@use-gesture/react';
import FocusTrap from 'focus-trap-react';
import { useSetting } from '$state/hooks/settings';
import { settingsAtom } from '$state/settings';
import { useAndroidBackHandler } from '$utils/androidBack';
import { stopPropagation } from '$utils/keyboard';
import { mobileOrTablet } from '$utils/user-agent';
import type { Icon } from '@phosphor-icons/react';
import {
  Image as ImageIcon,
  PlusCircle,
  ListBullets,
  MapPinPlusIcon,
  GridFour,
} from '$components/icons/phosphor';
import * as css from './AttachmentSheet.css';

interface AttachmentAction {
  icon: Icon;
  label: string;
  onClick: () => void;
}

export interface AttachmentSheetProps {
  open: boolean;
  onClose: () => void;
  onPickPhotos: () => void;
  onPickFile: () => void;
  onPickPoll: () => void;
  onPickLocation: () => void;
  containerRef: RefObject<HTMLElement>;
}

const SWIPE_THRESHOLD = 100;
const VELOCITY_THRESHOLD = 0.5;

export function AttachmentSheet({
  open,
  onClose,
  onPickPhotos,
  onPickFile,
  onPickPoll,
  onPickLocation,
  containerRef,
}: AttachmentSheetProps) {
  const [mobileGestures] = useSetting(settingsAtom, 'mobileGestures');
  const [reducedMotion] = useSetting(settingsAtom, 'reducedMotion');
  const containerEl = containerRef.current;
  const sheetRef = useRef<HTMLDivElement>(null);
  const skipReturnFocusRef = useRef(false);
  const y = useMotionValue(0);
  const prefersReducedMotion = useReducedMotion() ?? false;
  const shouldReduceMotion = reducedMotion || prefersReducedMotion;

  useEffect(() => {
    if (open) {
      skipReturnFocusRef.current = false;
      y.set(0);
    }
  }, [open, y]);

  useAndroidBackHandler(() => {
    onClose();
    return true;
  }, open);

  const gesturesEnabled = mobileGestures && mobileOrTablet();

  const bind = useDrag(
    ({ first, active, offset: [, oy], velocity: [, vy], direction: [, dy], event }) => {
      if (event && 'target' in event && event.target instanceof Element) {
        if (event.target.closest('[data-gestures="ignore"]')) {
          return;
        }
      }

      if (!gesturesEnabled) return;

      event.stopPropagation();

      const val = Math.max(0, oy);

      if (active) {
        if (first) y.stop();
        y.set(val);
      } else {
        const swipedDown = val > SWIPE_THRESHOLD || (vy > VELOCITY_THRESHOLD && dy > 0);

        if (swipedDown) {
          onClose();
        } else if (shouldReduceMotion) {
          y.set(0);
        } else {
          animate(y, 0, { type: 'spring', stiffness: 400, damping: 40 });
        }
      }
    },
    {
      axis: 'y',
      bounds: { top: 0, bottom: 300 },
      rubberband: true,
      filterTaps: true,
      pointer: { capture: true },
      from: () => [0, y.get()],
    }
  );

  const actions: AttachmentAction[] = [
    { icon: PlusCircle, label: 'Add File', onClick: onPickFile },
    { icon: ListBullets, label: 'Create Poll', onClick: onPickPoll },
    { icon: MapPinPlusIcon, label: 'Add Location', onClick: onPickLocation },
  ];

  const handleAction = (action: () => void) => {
    skipReturnFocusRef.current = true;
    action();
  };

  const sheetContent = (
    <>
      <div
        className={css.SheetHeader}
        {...(gesturesEnabled ? bind() : {})}
        style={gesturesEnabled ? { touchAction: 'none' } : undefined}
      >
        <div className={css.DragHandle} aria-hidden="true" />
        <h2 id="attachment-sheet-title" className={css.Heading}>
          Share
        </h2>
      </div>

      <div className={css.GallerySection}>
        <button
          type="button"
          className={css.GalleryButton}
          onClick={() => handleAction(onPickPhotos)}
          data-gestures="ignore"
          aria-label="Open photo gallery"
        >
          <div className={css.GalleryIcon} aria-hidden="true">
            <ImageIcon size={28} weight="regular" />
          </div>
          <span className={css.GalleryCopy}>
            <span className={css.GalleryTitle}>Photos</span>
            <span className={css.GalleryLabel}>Choose from your device</span>
          </span>
          <div className={css.GalleryGrid} aria-hidden="true">
            <GridFour size={22} weight="regular" />
          </div>
        </button>
      </div>

      <div className={css.ActionsRow}>
        {actions.map((action) => (
          <button
            key={action.label}
            type="button"
            className={css.ActionButton}
            onClick={() => handleAction(action.onClick)}
            data-gestures="ignore"
            aria-label={action.label}
          >
            <span className={css.ActionIcon} aria-hidden="true">
              <action.icon size={26} weight="regular" />
            </span>
            <span className={css.ActionLabel}>{action.label}</span>
          </button>
        ))}
      </div>
    </>
  );

  const sheetElement = (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            className={css.Backdrop}
            initial={shouldReduceMotion ? false : { opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: shouldReduceMotion ? 0 : 0.18 }}
            onClick={onClose}
            onPointerDown={(event) => event.stopPropagation()}
            data-gestures="ignore"
            aria-hidden="true"
          />

          <FocusTrap
            focusTrapOptions={{
              initialFocus: () => sheetRef.current ?? containerEl,
              fallbackFocus: () => sheetRef.current ?? containerEl,
              returnFocusOnDeactivate: true,
              setReturnFocus: (previousActiveElement: HTMLElement) =>
                skipReturnFocusRef.current ? false : previousActiveElement,
              allowOutsideClick: true,
              clickOutsideDeactivates: false,
              escapeDeactivates: (event: KeyboardEvent) => {
                if (!stopPropagation(event)) return false;
                onClose();
                return false;
              },
            }}
          >
            <motion.div
              ref={sheetRef}
              className={css.Sheet}
              initial={shouldReduceMotion ? false : { y: '100%' }}
              animate={{ y: 0 }}
              exit={{ y: '100%' }}
              transition={
                shouldReduceMotion
                  ? { duration: 0 }
                  : { type: 'spring', damping: 32, stiffness: 340 }
              }
              role="dialog"
              aria-modal="true"
              aria-labelledby="attachment-sheet-title"
              tabIndex={-1}
              onPointerDown={(event) => event.stopPropagation()}
            >
              <motion.div style={{ y, display: 'flex', flexDirection: 'column', flexGrow: 1 }}>
                {sheetContent}
              </motion.div>
            </motion.div>
          </FocusTrap>
        </>
      )}
    </AnimatePresence>
  );

  // Never render inline: without the active pane as a portal target, the sheet
  // could briefly anchor to the room layout and cover the sidebar.
  if (!containerEl) return null;

  return createPortal(sheetElement, containerEl);
}
