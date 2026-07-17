import { isTauri } from '@tauri-apps/api/core';
import { clearMediaSession, setMediaSession } from '$generated/tauri/commands';

export function pushSessionToSW(baseUrl?: string, accessToken?: string, userId?: string) {
  if (isTauri()) {
    // No service worker under Tauri; hand the token to the native sable-media protocol instead.
    if (baseUrl && accessToken) {
      void setMediaSession({ baseUrl, token: accessToken }).catch(() => undefined);
    } else {
      void clearMediaSession().catch(() => undefined);
    }
    return;
  }

  if (!('serviceWorker' in navigator)) return;
  if (!navigator.serviceWorker.controller) return;

  navigator.serviceWorker.controller.postMessage({
    type: 'setSession',
    accessToken,
    baseUrl,
    userId,
    // oxlint-disable-next-line unicorn/require-post-message-target-origin
  });
}
