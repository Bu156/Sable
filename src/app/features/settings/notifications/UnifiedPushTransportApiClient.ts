export type UnifiedPushTransportApi = {
  isPermissionGranted: () => Promise<boolean>;
  requestPermission: () => Promise<NotificationPermission>;
  registerForPushNotifications: () => Promise<string>;
  unregisterForPushNotifications: () => Promise<void>;
  listDistributors: () => Promise<string[]>;
  setDistributor: (name: string) => Promise<void>;
  setToken: (token: string) => Promise<void>;
};

export async function getUnifiedPushTransportApi(): Promise<UnifiedPushTransportApi> {
  const [notificationsApi, unifiedPushApi] = await Promise.all([
    import('@choochmeque/tauri-plugin-notifications-api'),
    import('$plugins/unifiedpush/api'),
  ]);
  return {
    isPermissionGranted: notificationsApi.isPermissionGranted,
    requestPermission: notificationsApi.requestPermission,
    registerForPushNotifications: unifiedPushApi.registerForPushNotifications,
    unregisterForPushNotifications: unifiedPushApi.unregisterForPushNotifications,
    listDistributors: unifiedPushApi.listDistributors,
    setDistributor: unifiedPushApi.setDistributor,
    setToken: unifiedPushApi.setToken,
  };
}
