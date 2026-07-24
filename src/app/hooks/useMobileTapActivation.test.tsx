import type { MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent } from 'react';
import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useMobileTapActivation } from './useMobileTapActivation';

type PointerInit = {
  pointerId?: number;
  pointerType?: string;
  isPrimary?: boolean;
  button?: number;
  clientX?: number;
  clientY?: number;
  timeStamp?: number;
};

const pointerEvent = (init: PointerInit = {}) =>
  ({
    pointerId: 1,
    pointerType: 'touch',
    isPrimary: true,
    button: 0,
    clientX: 0,
    clientY: 0,
    timeStamp: 0,
    preventDefault: vi.fn<() => void>(),
    ...init,
  }) as unknown as ReactPointerEvent<HTMLButtonElement>;

const clickEvent = () => ({}) as unknown as ReactMouseEvent<HTMLButtonElement>;

const setup = (enabled = true, withClickHandler = true) => {
  const onActivate = vi.fn<() => void>();
  const onClick = vi.fn<() => void>();
  const { result } = renderHook(() =>
    useMobileTapActivation<HTMLButtonElement>(
      enabled,
      onActivate,
      withClickHandler ? onClick : undefined
    )
  );
  return { onActivate, onClick, result };
};

describe('useMobileTapActivation', () => {
  it('activates a touch tap on pointerup, before any click arrives', () => {
    const { onActivate, onClick, result } = setup();
    const up = pointerEvent();

    act(() => {
      result.current.onPointerDown(pointerEvent());
      result.current.onPointerUp(up);
    });

    expect(onActivate).toHaveBeenCalledOnce();
    expect(onClick).not.toHaveBeenCalled();
    expect(up.preventDefault).toHaveBeenCalledOnce();
  });

  // The double-tap bug: pointerup activated, then the synthetic click ran the handler again.
  it('swallows the synthetic click that follows a touch tap', () => {
    const { onActivate, onClick, result } = setup();

    act(() => {
      result.current.onPointerDown(pointerEvent());
      result.current.onPointerUp(pointerEvent());
      result.current.onClick(clickEvent());
    });

    expect(onActivate).toHaveBeenCalledOnce();
    expect(onClick).not.toHaveBeenCalled();
  });

  it('leaves mouse clicks to the click handler', () => {
    const { onActivate, onClick, result } = setup();

    act(() => {
      result.current.onPointerDown(pointerEvent({ pointerType: 'mouse' }));
      result.current.onPointerUp(pointerEvent({ pointerType: 'mouse' }));
      result.current.onClick(clickEvent());
    });

    expect(onActivate).not.toHaveBeenCalled();
    expect(onClick).toHaveBeenCalledOnce();
  });

  it('does not activate when the touch moved beyond the tap threshold', () => {
    const { onActivate, onClick, result } = setup();

    act(() => {
      result.current.onPointerDown(pointerEvent());
      result.current.onPointerMove(pointerEvent({ clientX: 20 }));
      result.current.onPointerUp(pointerEvent({ clientX: 20 }));
    });

    expect(onActivate).not.toHaveBeenCalled();

    // No touch activation happened, so a click that does arrive must still get through.
    act(() => result.current.onClick(clickEvent()));
    expect(onClick).toHaveBeenCalledOnce();
  });

  // Guards `eligible`: the release-point check alone accepts this, the finger came back.
  it('does not activate a touch that wandered and returned to its origin', () => {
    const { onActivate, result } = setup();

    act(() => {
      result.current.onPointerDown(pointerEvent());
      result.current.onPointerMove(pointerEvent({ clientX: 50 }));
      result.current.onPointerUp(pointerEvent({ clientX: 0 }));
    });

    expect(onActivate).not.toHaveBeenCalled();
  });

  it('does not activate when enabled turns off mid-gesture', () => {
    const onActivate = vi.fn<() => void>();
    const { result, rerender } = renderHook(
      ({ enabled }: { enabled: boolean }) =>
        useMobileTapActivation<HTMLButtonElement>(enabled, onActivate),
      { initialProps: { enabled: true } }
    );

    act(() => result.current.onPointerDown(pointerEvent()));
    rerender({ enabled: false });
    act(() => result.current.onPointerUp(pointerEvent()));

    expect(onActivate).not.toHaveBeenCalled();
  });

  it('does not activate a touch held past the tap duration', () => {
    const { onActivate, result } = setup();

    act(() => {
      result.current.onPointerDown(pointerEvent({ timeStamp: 0 }));
      result.current.onPointerUp(pointerEvent({ timeStamp: 500 }));
    });

    expect(onActivate).not.toHaveBeenCalled();
  });

  it('does not activate when disabled, but still forwards the click', () => {
    const { onActivate, onClick, result } = setup(false);

    act(() => {
      result.current.onPointerDown(pointerEvent());
      result.current.onPointerUp(pointerEvent());
    });
    expect(onActivate).not.toHaveBeenCalled();

    act(() => result.current.onClick(clickEvent()));
    expect(onClick).toHaveBeenCalledOnce();
  });

  // Android WebView drops the click after a swipe, so a tap can activate with none following.
  it('resets the activation flag on pointerdown so it cannot swallow a later click', () => {
    const { onActivate, onClick, result } = setup();

    act(() => {
      result.current.onPointerDown(pointerEvent());
      result.current.onPointerUp(pointerEvent());
    });
    expect(onActivate).toHaveBeenCalledOnce();

    act(() => {
      result.current.onPointerDown(pointerEvent({ pointerType: 'mouse' }));
      result.current.onPointerUp(pointerEvent({ pointerType: 'mouse' }));
      result.current.onClick(clickEvent());
    });

    expect(onClick).toHaveBeenCalledOnce();
    expect(onActivate).toHaveBeenCalledOnce();
  });

  it('falls back to onActivate when no click handler is given', () => {
    const { onActivate, result } = setup(true, false);

    act(() => result.current.onClick(clickEvent()));

    expect(onActivate).toHaveBeenCalledOnce();
  });

  it('ignores a pointerup from a different pointer', () => {
    const { onActivate, result } = setup();

    act(() => {
      result.current.onPointerDown(pointerEvent({ pointerId: 1 }));
      result.current.onPointerUp(pointerEvent({ pointerId: 2 }));
    });

    expect(onActivate).not.toHaveBeenCalled();
  });

  it('does not activate after the pointer is cancelled', () => {
    const { onActivate, result } = setup();

    act(() => {
      result.current.onPointerDown(pointerEvent());
      result.current.onPointerCancel(pointerEvent());
      result.current.onPointerUp(pointerEvent());
    });

    expect(onActivate).not.toHaveBeenCalled();
  });
});
