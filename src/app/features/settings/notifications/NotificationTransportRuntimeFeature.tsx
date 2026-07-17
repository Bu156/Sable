import { useEffect, useMemo, useRef } from 'react';
import { isTauri } from '@tauri-apps/api/core';
import { type as osType } from '@tauri-apps/plugin-os';
import { useMatrixClient } from '$hooks/useMatrixClient';
import { useSetting } from '$state/hooks/settings';
import { settingsAtom } from '$state/settings';
import {
  NotificationTransportRuntime,
  type NotificationTransportRuntimeContext,
} from './NotificationTransportRuntime';
import {
  type NotificationTransportPlatform,
  normalizeNotificationTransportMode,
  resolvePreferredNotificationTransportProvider,
} from './NotificationTransport';

function currentPlatform(): NotificationTransportPlatform {
  if (!isTauri()) return 'web';
  const platform = osType();
  if (platform === 'android') return 'android';
  if (platform === 'ios') return 'ios';
  return 'desktop';
}

export function NotificationTransportRuntimeFeature() {
  const mx = useMatrixClient();
  const [backgroundPushEnabled] = useSetting(settingsAtom, 'backgroundPushEnabled');
  const [backgroundPushProvider] = useSetting(settingsAtom, 'backgroundPushProvider');
  const [pushTransportMode] = useSetting(settingsAtom, 'pushTransportMode');
  const [useInAppNotifications] = useSetting(settingsAtom, 'useInAppNotifications');
  const [isNotificationSounds] = useSetting(settingsAtom, 'isNotificationSounds');
  const [showMessageContent] = useSetting(settingsAtom, 'showMessageContentInNotifications');
  const [showEncryptedMessageContent] = useSetting(
    settingsAtom,
    'showMessageContentInEncryptedNotifications'
  );

  const runtimeRef = useRef<NotificationTransportRuntime>();
  if (!runtimeRef.current) runtimeRef.current = new NotificationTransportRuntime();

  // Read fresh by the listener for each incoming push, so toggling display
  // settings doesn't tear the listener down.
  const contextRef = useRef<NotificationTransportRuntimeContext>({
    mx,
    showMessageContent,
    showEncryptedMessageContent,
    notificationSoundEnabled: isNotificationSounds,
    useInAppNotifications,
  });
  contextRef.current = {
    mx,
    showMessageContent,
    showEncryptedMessageContent,
    notificationSoundEnabled: isNotificationSounds,
    useInAppNotifications,
  };

  const platform = currentPlatform();
  const provider = useMemo(() => {
    if (!backgroundPushEnabled) return null;
    const preferred = resolvePreferredNotificationTransportProvider(
      normalizeNotificationTransportMode(pushTransportMode, platform),
      platform
    );
    return backgroundPushProvider ?? preferred;
  }, [backgroundPushEnabled, backgroundPushProvider, pushTransportMode, platform]);

  useEffect(() => {
    void runtimeRef.current?.sync(provider, () => contextRef.current);
  }, [provider]);

  useEffect(
    () => () => {
      void runtimeRef.current?.dispose();
    },
    []
  );

  return null;
}
