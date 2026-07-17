import { isTauri } from '@tauri-apps/api/core';

export function hasServiceWorker(): boolean {
  // Android WebViews (Tauri) do not support service workers.
  return 'serviceWorker' in navigator && !isTauri();
}

export function hasControllingServiceWorker(): boolean {
  return hasServiceWorker() && navigator.serviceWorker.controller !== null;
}

// window.location.origin is the string "null" on Tauri 2.x macOS/Linux because
// tauri:// is a non-standard (opaque) URL scheme per the WHATWG URL spec. Code
// that feeds origin into new URL() or uses it as a redirect/client URI breaks
// silently. Fall back to protocol + host, which yields "tauri://localhost".
export function getAppOrigin(): string {
  return window.location.origin === 'null'
    ? `${window.location.protocol}//${window.location.host}`
    : window.location.origin;
}
