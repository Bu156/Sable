import { useEffect, useState } from 'react';
import type { Room } from '$types/matrix-sdk';
import { hydrateRoomMember } from '$client/roomMemberHydration';
import { useMatrixClient } from './useMatrixClient';

/**
 * Under sliding sync, m.room.member events only arrive for senders in the
 * lazy-loaded sync window. Fetch the member on demand and bump local state so
 * the caller re-reads room member state (avatar, display name) once hydrated.
 */
export const useRoomMemberHydration = (room: Room, userId: string): number => {
  const mx = useMatrixClient();
  const [version, setVersion] = useState(0);

  useEffect(() => {
    if (!userId.startsWith('@') || room.getMember(userId)) return undefined;
    let disposed = false;
    void hydrateRoomMember(mx, room.roomId, userId).then(() => {
      if (!disposed && room.getMember(userId)) setVersion((v) => v + 1);
    });
    return () => {
      disposed = true;
    };
  }, [mx, room, userId]);

  return version;
};
