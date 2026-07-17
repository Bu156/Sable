import { isTauri } from '@tauri-apps/api/core';

export function hasServiceWorker(): boolean {
  // Android WebViews (Tauri) do not support service workers.
  return 'serviceWorker' in navigator && !isTauri();
}

export function hasControllingServiceWorker(): boolean {
  return hasServiceWorker() && navigator.serviceWorker.controller !== null;
}

// window.location.origin is "null" on Tauri (tauri:// is opaque per WHATWG).
export function getAppOrigin(): string {
  return window.location.origin === 'null'
    ? `${window.location.protocol}//${window.location.host}`
    : window.location.origin;
}
