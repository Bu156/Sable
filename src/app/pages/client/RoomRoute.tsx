import { useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ForumView } from '$features/forum';
import { Room } from '$features/room';
import { useRoom } from '$hooks/useRoom';
import {
  getDirectForumPath,
  getDirectRoomPath,
  getHomeForumPath,
  getHomeRoomPath,
  getSpaceForumPath,
  getSpaceRoomPath,
} from '$pages/pathUtils';
import { CustomRoomType } from '$types/matrix/room';

type RoomRouteSection = 'home' | 'direct' | 'space';

type RoomRouteProps = {
  section: RoomRouteSection;
  forum: boolean;
};

const decodeParam = (value: string | undefined): string | undefined =>
  value ? decodeURIComponent(value) : undefined;

export function RoomRoute({ section, forum }: RoomRouteProps) {
  const room = useRoom();
  const navigate = useNavigate();
  const { roomIdOrAlias, spaceIdOrAlias, eventId } = useParams();
  const isForum = room.getType() === CustomRoomType.Forum;

  useEffect(() => {
    if (isForum === forum) return;

    const roomRef = decodeParam(roomIdOrAlias);
    if (!roomRef) return;

    const eventRef = decodeParam(eventId);
    let path: string;
    if (section === 'space') {
      const spaceRef = decodeParam(spaceIdOrAlias);
      if (!spaceRef) return;
      path = isForum
        ? getSpaceForumPath(spaceRef, roomRef, eventRef)
        : getSpaceRoomPath(spaceRef, roomRef, eventRef);
    } else if (section === 'direct') {
      path = isForum ? getDirectForumPath(roomRef, eventRef) : getDirectRoomPath(roomRef, eventRef);
    } else {
      path = isForum ? getHomeForumPath(roomRef, eventRef) : getHomeRoomPath(roomRef, eventRef);
    }

    navigate(path, { replace: true });
  }, [eventId, forum, isForum, navigate, roomIdOrAlias, section, spaceIdOrAlias]);

  if (isForum !== forum) return null;
  return forum ? <ForumView /> : <Room />;
}
