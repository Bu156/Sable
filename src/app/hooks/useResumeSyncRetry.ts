import { useEffect } from 'react';
import { isTauri } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import type { MatrixClient } from '$types/matrix-sdk';
import { SyncState } from '$types/matrix-sdk';

export const useResumeSyncRetry = (mx: MatrixClient | undefined): void => {
  useEffect(() => {
    if (!mx || !isTauri()) return undefined;

    let disposed = false;
    let unlisten: (() => void) | undefined;

    listen('app-resumed', () => {
      const state = mx.getSyncState();
      if (state === SyncState.Error || state === SyncState.Reconnecting) {
        mx.retryImmediately();
      }
    }).then((fn) => {
      if (disposed) fn();
      else unlisten = fn;
    });

    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [mx]);
};
