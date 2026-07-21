import { useRef, useCallback, useState } from 'react';
import { mobileOrTablet } from '$utils/user-agent';

export function useMobileLongPress(callback: () => void, delay = 500) {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const firedRef = useRef(false);
  const [isPressing, setIsPressing] = useState(false);
  const touchStartY = useRef<number | null>(null);
  const touchStartX = useRef<number | null>(null);

  const clear = useCallback(() => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    setIsPressing(false);
    touchStartY.current = null;
    touchStartX.current = null;
  }, []);

  const onTouchStart = useCallback(
    (e: React.TouchEvent | TouchEvent) => {
      if (!mobileOrTablet()) return;
      firedRef.current = false;
      setIsPressing(true);
      if (e.touches && e.touches[0]) {
        touchStartY.current = e.touches[0].clientY;
        touchStartX.current = e.touches[0].clientX;
      }
      timerRef.current = setTimeout(() => {
        firedRef.current = true;
        setIsPressing(false);
        callback();
      }, delay);
    },
    [callback, delay]
  );

  const onTouchEnd = useCallback(() => {
    clear();
  }, [clear]);

  const onTouchMove = useCallback(
    (e: React.TouchEvent | TouchEvent) => {
      if (touchStartY.current === null || touchStartX.current === null || !e.touches || !e.touches[0]) {
        clear();
        return;
      }
      const currentY = e.touches[0].clientY;
      const currentX = e.touches[0].clientX;
      const diffY = Math.abs(currentY - touchStartY.current);
      const diffX = Math.abs(currentX - touchStartX.current);

      if (diffY > 10 || diffX > 10) {
        clear();
      }
    },
    [clear]
  );

  return { onTouchStart, onTouchEnd, onTouchMove, firedRef, isPressing };
}
