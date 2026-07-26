import { useAtomValue } from 'jotai';
import { useEffect, useRef } from 'react';
import type { MatrixEvent, RoomEventHandlerMap } from '$types/matrix-sdk';
import { ClientEvent, EventType, RoomEvent, SyncState } from '$types/matrix-sdk';
import { useMatrixClient } from '$hooks/useMatrixClient';
import { useSetting } from '$state/hooks/settings';
import { settingsAtom } from '$state/settings';
import { mDirectAtom } from '$state/mDirectList';
import { createLogger } from '$utils/debug';
import { getNotificationType } from '$utils/room/unread';
import {
  arePushRulesReady,
  evaluateNotification,
  isAwaitingDecryption,
  watchDecryption,
} from '$utils/localNotifications';
import { getLocalNotificationCache } from '$client/localNotificationCache';
import { backfillLocalNotifications, runLiveTimelineScan } from '$utils/localNotificationBackfill';

const logger = createLogger('NotificationRecorder');
const RECORDED_CAP = 300;
const HEARTBEAT_INTERVAL_MS = 60_000;

export function NotificationRecorder() {
  const mx = useMatrixClient();
  const mDirects = useAtomValue(mDirectAtom);
  const mDirectsRef = useRef(mDirects);
  mDirectsRef.current = mDirects;

  const recordedRef = useRef<Set<string>>(new Set());
  const decryptingRef = useRef<Set<string>>(new Set());
  const hasBackfilledRef = useRef(false);
  const backfillControllerRef = useRef<AbortController | undefined>(undefined);
  const decryptWatchersRef = useRef<Map<MatrixEvent, () => void>>(new Map());
  const hasScannedRef = useRef(false);
  const [storeContent] = useSetting(settingsAtom, 'showMessageContentInNotifications');
  const [storeEncryptedContent] = useSetting(
    settingsAtom,
    'showMessageContentInEncryptedNotifications'
  );
  const storeContentRef = useRef(storeContent);
  storeContentRef.current = storeContent;
  const storeEncryptedContentRef = useRef(storeContent && storeEncryptedContent);
  storeEncryptedContentRef.current = storeContent && storeEncryptedContent;
  const prevMxRef = useRef(mx);
  if (prevMxRef.current !== mx) {
    prevMxRef.current = mx;
    recordedRef.current = new Set();
    decryptingRef.current = new Set();
    hasBackfilledRef.current = false;
    hasScannedRef.current = false;
  }

  useEffect(() => {
    const userId = mx.getSafeUserId();
    const cache = getLocalNotificationCache(userId);
    const contentOptions = () => ({
      storeContent: storeContentRef.current,
      storeEncryptedContent: storeEncryptedContentRef.current,
    });

    const markRecorded = (eventId: string) => {
      recordedRef.current.add(eventId);
      if (recordedRef.current.size > RECORDED_CAP) {
        const oldest = recordedRef.current.values().next().value;
        if (oldest !== undefined) recordedRef.current.delete(oldest);
      }
    };

    const handler: RoomEventHandlerMap[RoomEvent.Timeline] = (
      mEvent,
      room,
      toStartOfTimeline,
      removed
    ) => {
      if (toStartOfTimeline || removed) return;
      if (!room) return;
      const eventId = mEvent.getId();
      if (!eventId) return;

      if (recordedRef.current.has(eventId)) return;

      // Leave unrecorded so the rescan picks it up once push rules arrive.
      if (!arePushRulesReady(mx)) return;

      const encrypted = isAwaitingDecryption(mEvent);
      if (encrypted && decryptingRef.current.has(eventId)) return;

      const evaluate = () =>
        evaluateNotification(
          mx,
          room,
          mEvent,
          mDirectsRef.current,
          getNotificationType(mx, room.roomId),
          { storeContent: encrypted ? storeEncryptedContentRef.current : storeContentRef.current }
        );

      markRecorded(eventId);
      const stored = evaluate();
      if (stored) cache.merge(stored);

      if (!encrypted) return;

      decryptingRef.current.add(eventId);
      decryptWatchersRef.current.set(
        mEvent,
        watchDecryption(
          mEvent,
          () => {
            decryptingRef.current.delete(eventId);
            const upgraded = evaluate();
            if (upgraded) cache.merge(upgraded);
          },
          () => decryptingRef.current.delete(eventId)
        )
      );
    };

    mx.on(RoomEvent.Timeline, handler);

    // Only advance the watermark while syncing, so an outage isn't treated as "nothing missed".
    const beat = () => {
      if (mx.getSyncState() === SyncState.Syncing) cache.updateLastSeenTs(Date.now());
    };
    const heartbeatInterval = setInterval(beat, HEARTBEAT_INTERVAL_MS);

    // SlidingSyncSdk assigns client.pushRules without emitting AccountData, so
    // this cannot wait on that event. Runs every start because shouldBackfill
    // declines whenever the heartbeat kept the gap under its threshold.
    const scanOnce = () => {
      if (hasScannedRef.current || !arePushRulesReady(mx)) return;
      hasScannedRef.current = true;
      void runLiveTimelineScan(mx, userId, mDirectsRef.current, contentOptions()).catch(
        (err: unknown) => {
          logger.warn('live timeline scan failed', err);
        }
      );
    };

    const onSync = (state: SyncState) => {
      if (
        state !== SyncState.Prepared &&
        state !== SyncState.Syncing &&
        state !== SyncState.Catchup
      ) {
        return;
      }
      scanOnce();

      if (hasBackfilledRef.current) return;
      hasBackfilledRef.current = true;
      const controller = new AbortController();
      backfillControllerRef.current = controller;
      void backfillLocalNotifications(
        mx,
        userId,
        contentOptions(),
        Date.now(),
        controller.signal
      ).catch((err: unknown) => {
        logger.warn('backfill failed', err);
      });
    };
    mx.on(ClientEvent.Sync, onSync);
    const currentState = mx.getSyncState();
    if (currentState) onSync(currentState);

    // Covers a later push-rule change.
    const onPushRules = (event: MatrixEvent) => {
      if (event.getType() !== (EventType.PushRules as string)) return;
      scanOnce();
    };
    mx.on(ClientEvent.AccountData, onPushRules);

    const decryptWatchers = decryptWatchersRef.current;
    return () => {
      mx.off(RoomEvent.Timeline, handler);
      mx.off(ClientEvent.Sync, onSync);
      mx.off(ClientEvent.AccountData, onPushRules);
      clearInterval(heartbeatInterval);
      // These hold mx, room and the previous account's cache through their closure.
      for (const stop of decryptWatchers.values()) stop();
      decryptWatchers.clear();
      backfillControllerRef.current?.abort();
      backfillControllerRef.current = undefined;
      beat();
    };
  }, [mx]);

  return null;
}
