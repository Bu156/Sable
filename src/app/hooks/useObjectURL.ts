import { useCallback, useEffect, useMemo, useRef } from 'react';

export const useObjectURL = (object?: Blob): string | undefined => {
  const url = useMemo(() => {
    if (object) return URL.createObjectURL(object);
    return undefined;
  }, [object]);

  useEffect(
    () => () => {
      if (url) URL.revokeObjectURL(url);
    },
    [url]
  );

  return url;
};

// For blob URLs created inside an async callback, which can resolve after unmount
// with no effect left to revoke them.  Owns one URL at a time per caller.
export const useCreateObjectURL = (): ((object: Blob) => string) => {
  const urlRef = useRef<string | undefined>(undefined);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (urlRef.current) URL.revokeObjectURL(urlRef.current);
      urlRef.current = undefined;
    };
  }, []);

  return useCallback((object: Blob) => {
    const url = URL.createObjectURL(object);
    if (urlRef.current) URL.revokeObjectURL(urlRef.current);
    if (!mountedRef.current) {
      URL.revokeObjectURL(url);
      urlRef.current = undefined;
      return url;
    }
    urlRef.current = url;
    return url;
  }, []);
};
