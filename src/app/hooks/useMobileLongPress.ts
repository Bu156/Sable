import { useRef, useCallback } from 'react';
import { mobileOrTablet } from '$utils/user-agent';

export function useMobileLongPress(callback: () => void, delay = 500) {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const firedRef = useRef(false);

  const clear = useCallback(() => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const onTouchStart = useCallback(() => {
    if (!mobileOrTablet()) return;
    firedRef.current = false;
    timerRef.current = setTimeout(() => {
      firedRef.current = true;
      callback();
    }, delay);
  }, [callback, delay]);

  const onTouchEnd = useCallback(() => {
    clear();
  }, [clear]);

  const onTouchMove = useCallback(() => {
    clear();
  }, [clear]);

  return { onTouchStart, onTouchEnd, onTouchMove, firedRef };
}
