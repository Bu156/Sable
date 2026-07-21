import { useRef, useCallback, useState } from 'react';
import { mobileOrTablet } from '$utils/user-agent';

export function useMobileLongPress(callback: () => void, delay = 500) {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const firedRef = useRef(false);
  const [isPressing, setIsPressing] = useState(false);

  const clear = useCallback(() => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    setIsPressing(false);
  }, []);

  const onTouchStart = useCallback(() => {
    if (!mobileOrTablet()) return;
    firedRef.current = false;
    setIsPressing(true);
    timerRef.current = setTimeout(() => {
      firedRef.current = true;
      setIsPressing(false);
      callback();
    }, delay);
  }, [callback, delay]);

  const onTouchEnd = useCallback(() => {
    clear();
  }, [clear]);

  const onTouchMove = useCallback(() => {
    clear();
  }, [clear]);

  return { onTouchStart, onTouchEnd, onTouchMove, firedRef, isPressing };
}
