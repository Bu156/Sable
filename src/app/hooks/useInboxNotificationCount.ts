import { useSyncExternalStore } from 'react';
import type { MatrixClient, RoomEventHandlerMap } from '$types/matrix-sdk';
import { RoomEvent } from '$types/matrix-sdk';
import { useMatrixClient } from '$hooks/useMatrixClient';
import { getLocalNotificationCache } from '$client/localNotificationCache';
import { isStoredNotificationRead, type StoredNotification } from '$utils/localNotifications';
import { throttleTrailing, type Throttled } from '$utils/throttleTrailing';

const RECOMPUTE_THROTTLE_MS = 500;

type ReceiptContent = Record<string, Record<string, Record<string, unknown>>>;

// Counting costs a room and timeline lookup per entry, so consumers share one
// subscription and one receipt listener, throttled.
class InboxCountStore {
  private count = 0;
  private readonly subscribers = new Set<() => void>();
  private readonly schedule: Throttled;
  private detach: (() => void) | undefined;

  constructor(
    readonly mx: MatrixClient,
    private readonly userId: string
  ) {
    this.schedule = throttleTrailing(this.recompute, RECOMPUTE_THROTTLE_MS);
  }

  getSnapshot = (): number => this.count;

  subscribe = (onChange: () => void): (() => void) => {
    this.subscribers.add(onChange);
    if (this.subscribers.size === 1) this.attach();

    return () => {
      this.subscribers.delete(onChange);
      if (this.subscribers.size === 0) this.teardown();
    };
  };

  private isUnreadMention = (entry: StoredNotification): boolean => {
    if (entry.dismissed) return false;
    if (!entry.highlight && !entry.isDM) return false;

    const room = this.mx.getRoom(entry.room_id);
    if (!room) return false;

    return !isStoredNotificationRead(room, this.userId, entry);
  };

  private recompute = (): void => {
    const next = getLocalNotificationCache(this.userId).countEntries(this.isUnreadMention);
    if (next === this.count) return;
    this.count = next;
    for (const onChange of this.subscribers) onChange();
  };

  private onReceipt: RoomEventHandlerMap[RoomEvent.Receipt] = (event) => {
    const content = event.getContent<ReceiptContent>();
    const readByUs = Object.values(content).some((byType) =>
      Object.values(byType).some((receipts) => this.userId in receipts)
    );
    if (readByUs) this.schedule();
  };

  private attach(): void {
    const unsubscribe = getLocalNotificationCache(this.userId).subscribe(this.schedule);
    this.mx.on(RoomEvent.Receipt, this.onReceipt);
    this.detach = () => {
      unsubscribe();
      this.mx.off(RoomEvent.Receipt, this.onReceipt);
    };
    this.recompute();
  }

  private teardown(): void {
    this.detach?.();
    this.detach = undefined;
    this.schedule.cancel();
    stores.delete(this.userId);
  }
}

const stores = new Map<string, InboxCountStore>();

const getStore = (mx: MatrixClient, userId: string): InboxCountStore => {
  const existing = stores.get(userId);
  // The old client's getRoom() answers null for everything, i.e. a zero count.
  if (existing && existing.mx === mx) return existing;

  const store = new InboxCountStore(mx, userId);
  stores.set(userId, store);
  return store;
};

export const useInboxNotificationCount = (): number => {
  const mx = useMatrixClient();
  const store = getStore(mx, mx.getSafeUserId());

  return useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
};
