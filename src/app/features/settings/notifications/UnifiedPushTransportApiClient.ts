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
  const api = await import('@choochmeque/tauri-plugin-notifications-api');
  return {
    isPermissionGranted: api.isPermissionGranted,
    requestPermission: api.requestPermission,
    registerForPushNotifications: api.registerForPushNotifications,
    unregisterForPushNotifications: api.unregisterForPushNotifications,
    listDistributors: api.listDistributors,
    setDistributor: api.setDistributor,
    setToken: api.setToken,
  };
}
