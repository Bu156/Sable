import type { MatrixClient, Room } from '$types/matrix-sdk';
import { EventType, MatrixEvent } from '$types/matrix-sdk';

const inFlight = new WeakMap<MatrixClient, Map<string, Promise<void>>>();

// Members whose state event could not be fetched (e.g. defunct bridge ghosts)
// are skipped for a while so virtualized-timeline remounts don't refetch them.
const FAILURE_TTL_MS = 5 * 60_000;
const failedAt = new WeakMap<MatrixClient, Map<string, number>>();

export const hydrateRoomMember = (
  mx: MatrixClient,
  roomId: string,
  userId: string
): Promise<void> => {
  const room = mx.getRoom(roomId);
  if (!room || room.getMember(userId)) return Promise.resolve();

  const key = `${roomId}\u0000${userId}`;
  const failedTs = failedAt.get(mx)?.get(key);
  if (failedTs !== undefined && Date.now() - failedTs < FAILURE_TTL_MS) return Promise.resolve();

  const pending = inFlight.get(mx) ?? new Map<string, Promise<void>>();
  inFlight.set(mx, pending);
  const existing = pending.get(key);
  if (existing) return existing;

  const request = mx
    .getStateEvent(roomId, EventType.RoomMember, userId)
    .then((content) => {
      failedAt.get(mx)?.delete(key);
      const currentRoom = mx.getRoom(roomId);
      if (!currentRoom || currentRoom.getMember(userId)) return;
      currentRoom.currentState.setStateEvents([
        new MatrixEvent({
          type: EventType.RoomMember,
          state_key: userId,
          room_id: roomId,
          sender: userId,
          content,
        }),
      ]);
    })
    .catch(() => {
      const failures = failedAt.get(mx) ?? new Map<string, number>();
      failedAt.set(mx, failures);
      failures.set(key, Date.now());
    })
    .finally(() => pending.delete(key));

  pending.set(key, request);
  return request;
};

export const hydrateRoomMembers = (
  mx: MatrixClient,
  roomId: string,
  userIds: Iterable<string>
): Promise<void[]> =>
  Promise.all(
    [...new Set(userIds)]
      .filter((userId) => userId.startsWith('@'))
      .map((userId) => hydrateRoomMember(mx, roomId, userId))
  );

export const getRoomMemberAvatarMxc = (room: Room, userId: string): string | undefined =>
  room.getMember(userId)?.getMxcAvatarUrl();
