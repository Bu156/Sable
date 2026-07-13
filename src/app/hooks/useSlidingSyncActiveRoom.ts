import { useEffect } from 'react';
import { useMatrixClient } from '$hooks/useMatrixClient';
import { getSlidingSyncManager } from '$client/initMatrix';
import { useSelectedRoom } from '$hooks/router/useSelectedRoom';
import { useSelectedSpace } from '$hooks/router/useSelectedSpace';

export const useSlidingSyncActiveRoom = (): void => {
  const mx = useMatrixClient();
  const roomId = useSelectedRoom();
  const spaceId = useSelectedSpace();

  useEffect(() => {
    const manager = getSlidingSyncManager(mx);
    if (!manager) return undefined;

    const activeRoomIds = [...new Set([spaceId, roomId].filter(Boolean))] as string[];
    activeRoomIds.forEach((activeRoomId) => manager.subscribeToRoom(activeRoomId));

    return () => {
      activeRoomIds.forEach((activeRoomId) => manager.unsubscribeFromRoom(activeRoomId));
    };
  }, [mx, roomId, spaceId]);
};
