import { useRef, useCallback, useState } from 'react';

export function useMobileLongPress(callback: () => void, delay = 500) {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const firedRef = useRef(false);
  const [isPressing, setIsPressing] = useState(false);
  const startY = useRef<number | null>(null);
  const startX = useRef<number | null>(null);

  const clear = useCallback(() => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    if (!firedRef.current) {
      setIsPressing(false);
    }
    startY.current = null;
    startX.current = null;
  }, []);

  const onPointerDown = useCallback(
    (e: React.PointerEvent | PointerEvent) => {
      if (e.pointerType !== 'touch') return;
      firedRef.current = false;
      setIsPressing(true);
      startY.current = e.clientY;
      startX.current = e.clientX;

      timerRef.current = setTimeout(() => {
        firedRef.current = true;
        callback();
        setTimeout(() => setIsPressing(false), 300);
      }, delay);
    },
    [callback, delay]
  );

  const onPointerUp = useCallback(() => {
    clear();
  }, [clear]);

  const onPointerMove = useCallback(
    (e: React.PointerEvent | PointerEvent) => {
      if (startY.current === null || startX.current === null || e.pointerType !== 'touch') {
        clear();
        return;
      }
      const diffY = Math.abs(e.clientY - startY.current);
      const diffX = Math.abs(e.clientX - startX.current);

      if (diffY > 10 || diffX > 10) {
        clear();
      }
    },
    [clear]
  );

  const onPointerCancel = useCallback(() => clear(), [clear]);

  return { onPointerDown, onPointerUp, onPointerMove, onPointerCancel, firedRef, isPressing };
}
