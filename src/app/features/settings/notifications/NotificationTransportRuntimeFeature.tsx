import { useEffect, useMemo, useRef } from 'react';
import { isTauri } from '@tauri-apps/api/core';
import { type as osType } from '@tauri-apps/plugin-os';
import { useMatrixClient } from '$hooks/useMatrixClient';
import { useClientConfig } from '$hooks/useClientConfig';
import { useSetting } from '$state/hooks/settings';
import { settingsAtom } from '$state/settings';
import { enableUnifiedPush, listenForUnifiedPushEndpointChanges } from './UnifiedPushNotifications';
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
  const clientConfig = useClientConfig();
  const [backgroundPushEnabled] = useSetting(settingsAtom, 'backgroundPushEnabled');
  const [backgroundPushProvider] = useSetting(settingsAtom, 'backgroundPushProvider');
  const [pushTransportMode] = useSetting(settingsAtom, 'pushTransportMode');
  const [pushTransportOverride] = useSetting(settingsAtom, 'pushTransportOverride');
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

  const upConfigRef = useRef<{ unifiedPushAppID?: string; unifiedPushGatewayUrl?: string }>({});
  upConfigRef.current = {
    unifiedPushAppID:
      pushTransportOverride?.unifiedPushAppID ??
      clientConfig.pushNotificationDetails?.unifiedPushAppID,
    unifiedPushGatewayUrl:
      pushTransportOverride?.unifiedPushGatewayUrl ??
      clientConfig.pushNotificationDetails?.unifiedPushGatewayUrl,
  };

  // Keep the pusher current: establish it when UnifiedPush becomes the active
  // transport (so it survives a fresh install/session, not just a manual toggle)
  // and refresh it whenever the distributor rotates the endpoint. Deduped by
  // endpoint so re-registration can't loop.
  const lastEndpointRef = useRef<string | null>(null);
  useEffect(() => {
    if (provider !== 'unifiedpush' || !mx) return undefined;

    const establish = () => {
      enableUnifiedPush(mx, upConfigRef.current)
        .then((result) => {
          lastEndpointRef.current = result.endpoint;
        })
        .catch(() => undefined);
    };

    establish();

    let cancelled = false;
    let listener: { unregister: () => Promise<void> | void } | undefined;
    void listenForUnifiedPushEndpointChanges((endpoint) => {
      if (endpoint === lastEndpointRef.current) return;
      lastEndpointRef.current = endpoint;
      establish();
    }).then((handle) => {
      if (cancelled) void handle.unregister();
      else listener = handle;
    });

    return () => {
      cancelled = true;
      void listener?.unregister();
    };
  }, [provider, mx]);

  useEffect(
    () => () => {
      void runtimeRef.current?.dispose();
    },
    []
  );

  return null;
}
