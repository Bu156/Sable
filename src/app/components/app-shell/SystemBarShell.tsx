import { type ReactNode, type RefObject, useEffect, useRef, useState } from 'react';
import { invoke, isTauri } from '@tauri-apps/api/core';
import { type as osType } from '@tauri-apps/plugin-os';
import { updateThemeColorMeta } from '../../theme/themeColorMeta';

const safeAreaTop = 'var(--safe-area-inset-top, env(safe-area-inset-top, 0px))';
const safeAreaBottom = 'var(--safe-area-inset-bottom, env(safe-area-inset-bottom, 0px))';
const iosBottomInset = `max(${safeAreaBottom}, var(--keyboard-height, 0px))`;
const safeAreaLeft = 'var(--safe-area-inset-left, env(safe-area-inset-left, 0px))';
const safeAreaRight = 'var(--safe-area-inset-right, env(safe-area-inset-right, 0px))';

const TRANSPARENT = /^(transparent$|rgba?\(\s*0\s*,\s*0\s*,\s*0\s*,\s*0\s*\))/;

// First non-transparent background color painted at (x, y).
function readSurfaceColor(x: number, y: number): string | undefined {
  let el = document.elementFromPoint(x, y);
  while (el) {
    const bg = getComputedStyle(el).backgroundColor;
    if (bg && !TRANSPARENT.test(bg)) return bg;
    el = el.parentElement;
  }
  return undefined;
}

// "rgb(r, g, b)" -> packed ARGB int for the native Android status bar.
function rgbToArgb(color: string): number | undefined {
  const parts = color.match(/\d+/g);
  if (!parts || parts.length < 3) return undefined;
  const [r, g, b] = parts.map((part) => parseInt(part, 10));
  if (r === undefined || g === undefined || b === undefined) return undefined;
  return ((0xff << 24) | (r << 16) | (g << 8) | b) >>> 0;
}

// Color of whatever surface is rendered just below the top strip.
function useTopBarColor(probeRef: RefObject<HTMLDivElement>, android: boolean): string | undefined {
  const [color, setColor] = useState<string>();
  const lastRef = useRef<string>();

  useEffect(() => {
    let frame = 0;
    const sample = () => {
      frame = 0;
      const rect = probeRef.current?.getBoundingClientRect();
      const x = Math.round(rect ? rect.left + rect.width / 2 : window.innerWidth / 2);
      const y = Math.round((rect?.bottom ?? 0) + 1);
      const next = readSurfaceColor(x, y);
      if (next && next !== lastRef.current) {
        lastRef.current = next;
        setColor(next);
        updateThemeColorMeta(next);
        if (android) {
          const argb = rgbToArgb(next);
          if (argb !== undefined) invoke('set_status_bar_color', { color: argb }).catch(() => {});
        }
      }
    };
    // Trailing edge: sample once mutations settle, so navigation recolors land.
    const schedule = () => {
      if (frame) cancelAnimationFrame(frame);
      frame = requestAnimationFrame(sample);
    };

    schedule();
    const observer = new MutationObserver(schedule);
    // childList = navigation; class/style = theme swaps and per-view recolors.
    observer.observe(document.body, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ['class', 'style'],
    });
    observer.observe(document.head, { childList: true }); // remote-theme css
    window.addEventListener('resize', schedule);

    return () => {
      if (frame) cancelAnimationFrame(frame);
      observer.disconnect();
      window.removeEventListener('resize', schedule);
    };
  }, [probeRef, android]);

  return color;
}

type SystemBarStripProps = {
  position: 'top' | 'bottom';
  size: string;
  background: string;
  stripRef?: RefObject<HTMLDivElement>;
  transition?: string;
};

function SystemBarStrip({ position, size, background, stripRef, transition }: SystemBarStripProps) {
  return (
    <div
      ref={stripRef}
      style={{
        height: size,
        flexShrink: 0,
        overflow: 'hidden',
        transition,
      }}
    >
      <div
        style={{
          width: '100%',
          height: '100%',
          background,
          ...(position === 'top'
            ? { borderBottom: '1px solid var(--sable-bg-container-line)' }
            : { borderTop: '1px solid var(--sable-surface-container-line)' }),
        }}
      />
    </div>
  );
}

type SystemBarShellProps = {
  children: ReactNode;
  onPortalContainerChange: (node: HTMLDivElement | null) => void;
};

export function SystemBarShell({ children, onPortalContainerChange }: SystemBarShellProps) {
  const tauriOs = isTauri() ? osType() : undefined;
  const enabled = tauriOs === 'android' || tauriOs === 'ios';

  const topStripRef = useRef<HTMLDivElement>(null);
  const topColor = useTopBarColor(topStripRef, tauriOs === 'android');

  return (
    <>
      {enabled && (
        <SystemBarStrip
          position="top"
          size={safeAreaTop}
          background={topColor ?? 'var(--sable-bg-container)'}
          stripRef={topStripRef}
        />
      )}

      <div
        style={{
          position: 'relative',
          display: 'flex',
          flexDirection: 'column',
          width: '100%',
          minHeight: 0,
          flex: 1,
          paddingLeft: enabled ? safeAreaLeft : 0,
          paddingRight: enabled ? safeAreaRight : 0,
        }}
      >
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            width: '100%',
            minHeight: 0,
            flex: 1,
          }}
        >
          {children}
        </div>

        <div id="portalContainer" ref={onPortalContainerChange} />
      </div>

      {enabled && (
        <SystemBarStrip
          position="bottom"
          size={tauriOs === 'ios' ? iosBottomInset : safeAreaBottom}
          background="var(--sable-surface-container)"
          transition={tauriOs === 'ios' ? 'height 0.25s ease-out' : undefined}
        />
      )}
    </>
  );
}
