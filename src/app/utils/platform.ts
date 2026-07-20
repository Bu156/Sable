import { isTauri } from '@tauri-apps/api/core';
import { type as osType } from '@tauri-apps/plugin-os';

export function hasServiceWorker(): boolean {
  // Android WebViews (Tauri) do not support service workers.
  return 'serviceWorker' in navigator && !isTauri();
}

const DESKTOP_TAURI_OS = new Set(['linux', 'macos', 'windows']);

export function isDesktopTauri(): boolean {
  return isTauri() && DESKTOP_TAURI_OS.has(osType());
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
