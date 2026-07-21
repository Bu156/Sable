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

  const onTouchStart = useCallback(
    (e: React.TouchEvent | TouchEvent) => {
      firedRef.current = false;
      setIsPressing(true);
      if ('touches' in e && e.touches[0]) {
        startY.current = e.touches[0].clientY;
        startX.current = e.touches[0].clientX;
      }
      
      timerRef.current = setTimeout(() => {
        firedRef.current = true;
        callback();
        setTimeout(() => setIsPressing(false), 300);
      }, delay);
    },
    [callback, delay]
  );

  const onTouchEnd = useCallback(() => {
    clear();
  }, [clear]);

  const onTouchMove = useCallback(
    (e: React.TouchEvent | TouchEvent) => {
      if (startY.current === null || startX.current === null || !('touches' in e) || !e.touches[0]) {
        clear();
        return;
      }
      const diffY = Math.abs(e.touches[0].clientY - startY.current);
      const diffX = Math.abs(e.touches[0].clientX - startX.current);

      if (diffY > 10 || diffX > 10) {
        clear();
      }
    },
    [clear]
  );
  
  const onTouchCancel = useCallback(() => clear(), [clear]);

  return { onTouchStart, onTouchEnd, onTouchMove, onTouchCancel, firedRef, isPressing };
}
