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
  const notificationsApi = await import('@choochmeque/tauri-plugin-notifications-api');
  return {
    isPermissionGranted: notificationsApi.isPermissionGranted,
    requestPermission: notificationsApi.requestPermission,
    registerForPushNotifications: notificationsApi.registerForPushNotifications,
    unregisterForPushNotifications: notificationsApi.unregisterForPushNotifications,
    listDistributors: notificationsApi.listDistributors,
    setDistributor: notificationsApi.setDistributor,
    setToken: notificationsApi.setToken,
  };
}
