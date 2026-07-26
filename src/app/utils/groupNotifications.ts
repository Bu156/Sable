import { EventType } from '$types/matrix-sdk';
import type { StoredNotification } from './localNotifications';

type RoomNotificationsGroup = {
  roomId: string;
  notifications: StoredNotification[];
};

export const groupNotifications = (
  notifications: StoredNotification[],
  allowRooms: Set<string>
): RoomNotificationsGroup[] => {
  const groups: RoomNotificationsGroup[] = [];
  notifications.forEach((notification) => {
    if (notification.event.type === (EventType.RoomMember as string)) return;
    if (!allowRooms.has(notification.room_id)) return;

    const groupIndex = groups.length - 1;
    const lastAddedGroup: RoomNotificationsGroup | undefined = groups[groupIndex];
    if (notification.room_id === lastAddedGroup?.roomId) {
      lastAddedGroup.notifications.push(notification);
      return;
    }
    groups.push({
      roomId: notification.room_id,
      notifications: [notification],
    });
  });
  return groups;
};
