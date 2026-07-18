import type { ReactNode } from 'react';
import { useCallback } from 'react';
import { useSetAtom } from 'jotai';
import { matchPath, useLocation, useNavigate } from 'react-router-dom';
import { resolveSection } from '$pages/pathUtils';
import { HOME_ROOM_PATH, DIRECT_ROOM_PATH, SPACE_ROOM_PATH } from '$pages/paths';
import { lastVisitedRoomAtom } from '$state/room/lastRoom';

type BackRouteHandlerProps = {
  children: (onBack: () => void) => ReactNode;
};
export function BackRouteHandler({ children }: BackRouteHandlerProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const setLastRoom = useSetAtom(lastVisitedRoomAtom);

  const goBack = useCallback(() => {
    const section = resolveSection(location.pathname);
    if (!section) return;

    const roomPaths = [HOME_ROOM_PATH, DIRECT_ROOM_PATH, SPACE_ROOM_PATH];
    const roomMatch = roomPaths
      .map((path) => matchPath({ path, end: false }, location.pathname))
      .find((match) => match !== null);

    const currentRoomIdOrAlias = roomMatch?.params.roomIdOrAlias;
    if (section.getRoomPath && currentRoomIdOrAlias) {
      setLastRoom({
        section: section.key,
        roomId: decodeURIComponent(currentRoomIdOrAlias),
      });
    }

    navigate(section.listPath);
  }, [navigate, location, setLastRoom]);

  return children(goBack);
}
