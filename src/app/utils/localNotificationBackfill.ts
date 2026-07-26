import type { MatrixClient, MatrixEvent, Room } from '$types/matrix-sdk';
import { ClientEvent, EventType } from '$types/matrix-sdk';
import { NotificationType } from '$types/matrix/room';
import { getLocalNotificationCache } from '$client/localNotificationCache';
import { createLogger } from '$utils/debug';
import { getAccountData, getStateEvent } from '$utils/room/hierarchy';
import { getMDirects, getNotificationType } from '$utils/room/unread';
import {
  evaluateNotification,
  isAwaitingDecryption,
  selectBackfillRooms,
  shouldBackfill,
  watchDecryption,
  backfillPageCount,
  type BackfillRoomInfo,
  type StoredNotification,
} from './localNotifications';

const logger = createLogger('localNotificationBackfill');
const SCROLLBACK_LIMIT = 50;

// Bounds the transient batch; the cache only keeps MAX_ENTRIES anyway.
const SCAN_FLUSH_BATCH = 200;

export type ScanContentOptions = {
  storeContent: boolean;
  storeEncryptedContent: boolean;
};

const isEncryptedRoom = (room: Room): boolean =>
  getStateEvent(room, EventType.RoomEncryption) !== undefined;

export const runLiveTimelineScan = async (
  mx: MatrixClient,
  userId: string,
  mDirects: Set<string>,
  content: ScanContentOptions
): Promise<number> => {
  const cache = getLocalNotificationCache(userId);
  const pending: StoredNotification[] = [];
  let recorded = 0;

  const flush = () => {
    if (pending.length === 0) return;
    cache.mergeMany(pending);
    recorded += pending.length;
    pending.length = 0;
  };

  for (const room of mx.getRooms()) {
    if (room.isSpaceRoom()) continue;
    const notificationType = getNotificationType(mx, room.roomId);
    if (notificationType === NotificationType.Mute) continue;

    const storeContent = isEncryptedRoom(room)
      ? content.storeEncryptedContent
      : content.storeContent;
    for (const mEvent of room.getLiveTimeline().getEvents()) {
      const stored = evaluateNotification(mx, room, mEvent, mDirects, notificationType, {
        storeContent,
      });
      if (!stored) continue;
      pending.push(stored);
      if (pending.length >= SCAN_FLUSH_BATCH) flush();
    }

    // eslint-disable-next-line no-await-in-loop
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  flush();

  logger.log('live timeline scan complete', { recorded });
  return recorded;
};

export const backfillLocalNotifications = async (
  mx: MatrixClient,
  userId: string,
  content: ScanContentOptions,
  now: number = Date.now(),
  signal?: AbortSignal
): Promise<number> => {
  const cache = getLocalNotificationCache(userId);
  const lastSeenTs = cache.getLastSeenTs();
  const watermark = shouldBackfill(lastSeenTs, now);
  if (watermark === undefined) {
    logger.log('backfill skipped', {
      reason: lastSeenTs === undefined ? 'new-device' : 'small-gap',
    });
    return 0;
  }

  const allRooms = mx.getRooms();
  const roomInfos: BackfillRoomInfo[] = allRooms.map((room) => ({
    roomId: room.roomId,
    lastActiveTs: room.getLastActiveTimestamp(),
    isSpaceRoom: room.isSpaceRoom(),
    isMuted: getNotificationType(mx, room.roomId) === NotificationType.Mute,
  }));
  const selectedRoomIds = selectBackfillRooms(roomInfos, watermark);
  const pages = backfillPageCount(watermark, now);
  const activeRooms = roomInfos.filter(
    (r) => !r.isSpaceRoom && !r.isMuted && r.lastActiveTs > watermark
  ).length;

  logger.log('backfill starting', {
    rooms: selectedRoomIds.length,
    skippedRooms: activeRooms - selectedRoomIds.length,
    pages,
    gapMs: now - watermark,
  });

  // m.direct may not have arrived at SyncState.Prepared yet.
  const mDirectEvent = getAccountData(mx, EventType.Direct);
  let mDirects: Set<string>;
  if (mDirectEvent) {
    mDirects = getMDirects(mDirectEvent);
  } else {
    mDirects = await new Promise<Set<string>>((resolve) => {
      const handler = (event: MatrixEvent) => {
        if (event.getType() === (EventType.Direct as string)) {
          mx.off(ClientEvent.AccountData, handler);
          resolve(getMDirects(event));
        }
      };
      mx.on(ClientEvent.AccountData, handler);
      setTimeout(() => {
        mx.off(ClientEvent.AccountData, handler);
        resolve(new Set<string>());
      }, 5000);
    });
  }

  let recorded = 0;
  const processed = new Set<string>();
  const stopWatchers: (() => void)[] = [];
  const releaseWatchers = () => {
    for (const stop of stopWatchers) stop();
    stopWatchers.length = 0;
  };
  signal?.addEventListener('abort', releaseWatchers, { once: true });

  for (const roomId of selectedRoomIds) {
    if (signal?.aborted) return recorded;
    const room = mx.getRoom(roomId);
    if (!room) continue;
    const notificationType = getNotificationType(mx, roomId);
    if (notificationType === NotificationType.Mute) continue;
    const storeContent = isEncryptedRoom(room)
      ? content.storeEncryptedContent
      : content.storeContent;

    try {
      for (let page = 0; page < pages; page += 1) {
        if (signal?.aborted) return recorded;
        // eslint-disable-next-line no-await-in-loop
        await mx.scrollback(room, SCROLLBACK_LIMIT);
        const events = room.getLiveTimeline().getEvents();

        for (const mEvent of events.toReversed()) {
          if (mEvent.getTs() <= watermark) break;
          if (signal?.aborted) return recorded;
          const eventId = mEvent.getId();
          if (!eventId || processed.has(eventId)) continue;
          processed.add(eventId);
          const evaluate = () =>
            evaluateNotification(mx, room, mEvent, mDirects, notificationType, { storeContent });

          const stored = evaluate();
          if (stored) {
            cache.merge(stored);
            recorded += 1;
          }

          // Also watch events that did not notify as ciphertext: a mention is
          // only visible once the clear event arrives.
          if (isAwaitingDecryption(mEvent)) {
            stopWatchers.push(
              watchDecryption(mEvent, () => {
                const upgraded = evaluate();
                if (upgraded) cache.merge(upgraded);
              })
            );
          }
        }

        const hasOlder = events.some((e) => e.getTs() < watermark);
        if (hasOlder) break;
      }
    } catch (err) {
      logger.warn('backfill room failed', { roomId, err });
    }
    // eslint-disable-next-line no-await-in-loop
    await new Promise((r) => setTimeout(r, 0));
  }

  logger.log('backfill complete', { recorded });
  return recorded;
};
