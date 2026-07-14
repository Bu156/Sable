import { useEffect, useState } from 'react';
import { useMatrixClient } from '$hooks/useMatrixClient';
import { getSlidingSyncManager } from '$client/initMatrix';
import { useResolvedSelectedRoom, useResolvedSelectedSpace } from '$hooks/router/useResolvedRoomId';
import { useSpaces } from '$state/hooks/roomList';
import { allRoomsAtom } from '$state/room-list/roomList';
import { ClientEvent } from '$types/matrix-sdk';

const useAvailableSlidingSyncManager = () => {
  const mx = useMatrixClient();
  const [manager, setManager] = useState(() => getSlidingSyncManager(mx));

  useEffect(() => {
    if (manager) return undefined;

    const checkForManager = () => {
      const nextManager = getSlidingSyncManager(mx);
      if (nextManager) setManager(nextManager);
    };

    const retryId = globalThis.setTimeout(checkForManager, 0);
    mx.on(ClientEvent.Sync, checkForManager);
    return () => {
      globalThis.clearTimeout(retryId);
      mx.removeListener(ClientEvent.Sync, checkForManager);
    };
  }, [manager, mx]);

  return manager;
};

export const useSlidingSyncRouteRooms = (): void => {
  const manager = useAvailableSlidingSyncManager();
  const { roomId, resolving: resolvingRoom } = useResolvedSelectedRoom();
  const { roomId: spaceId, resolving: resolvingSpace } = useResolvedSelectedSpace();

  useEffect(() => {
    if (!manager || resolvingRoom || resolvingSpace) return undefined;

    const activeRoomIds = [...new Set([spaceId, roomId].filter(Boolean))] as string[];
    activeRoomIds.forEach((activeRoomId) => manager.subscribeToRoom(activeRoomId));

    return () => activeRoomIds.forEach((activeRoomId) => manager.unsubscribeFromRoom(activeRoomId));
  }, [manager, resolvingRoom, resolvingSpace, roomId, spaceId]);
};

export const useSlidingSyncSpaceSubscriptions = (): void => {
  const manager = useAvailableSlidingSyncManager();
  const mx = useMatrixClient();
  const spaces = useSpaces(mx, allRoomsAtom);

  useEffect(() => {
    if (!manager) return undefined;
    manager.setSpaceSubscriptions(spaces);
    return undefined;
  }, [manager, spaces]);
};

export const useSlidingSyncRoomLoading = (roomId: string): boolean => {
  const manager = useAvailableSlidingSyncManager();
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!manager) {
      setLoading(false);
      return undefined;
    }

    return manager.onRoomSubscriptionStatus(roomId, setLoading);
  }, [manager, roomId]);

  return loading;
};

export const useSlidingSyncActiveRoom = (): void => {
  useSlidingSyncRouteRooms();
  useSlidingSyncSpaceSubscriptions();
};
