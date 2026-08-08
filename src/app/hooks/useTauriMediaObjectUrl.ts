import { isTauri } from '@tauri-apps/api/core';
import { useEffect, useState } from 'react';
import { ensureMediaObjectUrl, getMediaObjectUrl } from '$utils/mediaObjectUrlCache';

/**
 * Resolves `src` to a session-cached blob object URL on Tauri, where the media scheme
 * bypasses the webview's HTTP cache. Falls back to the raw URL on fetch failure.
 * Pass-through outside Tauri, where the service worker caches media.
 */
export const useTauriMediaObjectUrl = (src: string | undefined): string | undefined => {
  const active = isTauri() && src !== undefined;
  const [resolved, setResolved] = useState<string | undefined>(() =>
    active ? (getMediaObjectUrl(src) ?? undefined) : src
  );

  useEffect(() => {
    if (!active) {
      setResolved(src);
      return undefined;
    }

    let cancelled = false;
    const cached = getMediaObjectUrl(src);
    if (cached !== undefined) {
      setResolved(cached);
      return undefined;
    }

    setResolved(undefined);
    ensureMediaObjectUrl(src).then(
      (objectUrl) => {
        if (!cancelled) setResolved(objectUrl);
      },
      () => {
        if (!cancelled) setResolved(src);
      }
    );

    return () => {
      cancelled = true;
    };
  }, [active, src]);

  return active ? resolved : src;
};
