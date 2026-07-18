import { useEffect } from 'react';
import { isTauri } from '@tauri-apps/api/core';
import { type as osType } from '@tauri-apps/plugin-os';
import { createLogger } from '$utils/debug';

const log = createLogger('DesktopUpdater');

const DESKTOP_TAURI_OS = new Set(['linux', 'macos', 'windows']);
const isDesktopTauri = (): boolean => isTauri() && DESKTOP_TAURI_OS.has(osType());

async function checkForDesktopUpdate(): Promise<void> {
  const { check } = await import('@tauri-apps/plugin-updater');
  const update = await check();
  if (!update) return;

  log.log(`update ${update.version} available`);
  const { ask } = await import('@tauri-apps/plugin-dialog');

  const shouldInstall = await ask(`Sable ${update.version} is available. Install it now?`, {
    title: 'Update available',
    kind: 'info',
    okLabel: 'Install',
    cancelLabel: 'Later',
  });
  if (!shouldInstall) return;

  await update.downloadAndInstall();

  const { relaunch } = await import('@tauri-apps/plugin-process');
  const shouldRestart = await ask('Update installed. Restart Sable to finish?', {
    title: 'Restart required',
    kind: 'info',
    okLabel: 'Restart',
    cancelLabel: 'Later',
  });
  if (shouldRestart) await relaunch();
}

export function DesktopUpdater() {
  useEffect(() => {
    if (!isDesktopTauri()) return;
    checkForDesktopUpdate().catch((err) => log.error('update check failed', err));
  }, []);

  return null;
}
