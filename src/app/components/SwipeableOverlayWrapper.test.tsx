import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { animate } from 'framer-motion';
import { SwipeableOverlayWrapper } from './SwipeableOverlayWrapper';

vi.mock('$utils/platform', () => ({
  isMobileOrTablet: () => true,
}));

vi.mock('framer-motion', () => {
  const animateMock = vi.fn<(...args: unknown[]) => Promise<void>>(() => Promise.resolve());
  return {
    animate: animateMock,
    motion: { div: 'div' },
    useMotionValue: (initial: number) => {
      let value = initial;
      return {
        get: () => value,
        set: (next: number) => {
          value = next;
        },
        stop: vi.fn<() => void>(),
      };
    },
  };
});

const touchList = (target: HTMLElement, clientX: number, clientY: number) => {
  const point = { identifier: 0, target, clientX, clientY, pageX: clientX, pageY: clientY };
  return { touches: [point], targetTouches: [point], changedTouches: [point] };
};

function renderWrapper(direction: 'left' | 'right' | 'both', onClose: () => void) {
  render(
    <SwipeableOverlayWrapper direction={direction} onClose={onClose}>
      <div data-testid="content" />
    </SwipeableOverlayWrapper>
  );
  return screen.getByTestId('content');
}

describe('SwipeableOverlayWrapper', () => {
  beforeEach(() => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 320 });
    vi.mocked(animate).mockClear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('closes after a single horizontal move past the distance threshold', async () => {
    const onClose = vi.fn<() => void>();
    const content = renderWrapper('both', onClose);

    fireEvent.touchStart(content, touchList(content, 260, 100));
    fireEvent.touchMove(content, touchList(content, 100, 100));
    fireEvent.touchEnd(content, {
      ...touchList(content, 100, 100),
      touches: [],
      targetTouches: [],
    });

    await Promise.resolve();

    expect(animate).toHaveBeenCalledWith(expect.anything(), -320, {
      duration: 0.22,
      ease: 'easeOut',
    });
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('leaves a vertical member-list scroll alone', () => {
    const onClose = vi.fn<() => void>();
    const content = renderWrapper('both', onClose);

    fireEvent.touchStart(content, touchList(content, 160, 100));
    fireEvent.touchMove(content, touchList(content, 165, 260));
    fireEvent.touchEnd(content, {
      ...touchList(content, 165, 260),
      touches: [],
      targetTouches: [],
    });

    expect(onClose).not.toHaveBeenCalled();
    expect(animate).not.toHaveBeenCalled();
  });

  it('does not close a cancelled horizontal gesture', () => {
    const onClose = vi.fn<() => void>();
    const content = renderWrapper('both', onClose);

    fireEvent.touchStart(content, touchList(content, 260, 100));
    fireEvent.touchMove(content, touchList(content, 100, 100));
    fireEvent.touchCancel(content, { touches: [], targetTouches: [] });

    expect(onClose).not.toHaveBeenCalled();
    expect(animate).toHaveBeenCalledWith(expect.anything(), 0, {
      duration: 0.22,
      ease: 'easeOut',
    });
  });

  it('does not close on a disallowed swipe direction', () => {
    const onClose = vi.fn<() => void>();
    const content = renderWrapper('right', onClose);

    fireEvent.touchStart(content, touchList(content, 260, 100));
    fireEvent.touchMove(content, touchList(content, 100, 100));
    fireEvent.touchEnd(content, {
      ...touchList(content, 100, 100),
      touches: [],
      targetTouches: [],
    });

    expect(onClose).not.toHaveBeenCalled();
  });
});
