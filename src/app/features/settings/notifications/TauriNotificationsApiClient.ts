export type NotificationPluginListener = {
  unregister: () => Promise<void> | void;
};

export type TauriNotificationsApi = {
  Importance: {
    readonly None: 0;
    readonly Min: 1;
    readonly Low: 2;
    readonly Default: 3;
    readonly High: 4;
  };
  createChannel: (channel: {
    id: string;
    name: string;
    description?: string;
    importance?: number;
    vibration?: boolean;
  }) => Promise<void>;
  sendNotification: (payload: Record<string, unknown>) => Promise<void>;
  removeActive: (payload: Array<{ id: number; tag?: string }>) => Promise<void>;
  onNotificationReceived: (
    listener: (notification: Record<string, unknown>) => void
  ) => Promise<NotificationPluginListener>;
};

let notificationsApiPromise: Promise<TauriNotificationsApi> | null = null;

export async function getTauriNotificationsApi(): Promise<TauriNotificationsApi> {
  if (!notificationsApiPromise) {
    notificationsApiPromise =
      import('@choochmeque/tauri-plugin-notifications-api') as unknown as Promise<TauriNotificationsApi>;
  }

  return notificationsApiPromise;
}
