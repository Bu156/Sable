import { useAtomValue } from 'jotai';
import { matchPath, useLocation, useParams } from 'react-router-dom';
import { getCanonicalAliasRoomId, isRoomAlias } from '$utils/matrix';
import { useMatrixClient } from '$hooks/useMatrixClient';
import { resolveSection } from '$pages/pathUtils';
import { lastVisitedRoomAtom } from '$state/room/lastRoom';

export const useSelectedRoom = (): string | undefined => {
  const mx = useMatrixClient();

  const { roomIdOrAlias: encodedRoomIdOrAlias } = useParams();
  const roomIdOrAlias = encodedRoomIdOrAlias && decodeURIComponent(encodedRoomIdOrAlias);
  const roomId =
    roomIdOrAlias && isRoomAlias(roomIdOrAlias)
      ? getCanonicalAliasRoomId(mx, roomIdOrAlias)
      : roomIdOrAlias;

  return roomId;
};

export const useSelectedOrLastRoom = (): string | undefined => {
  const selectedRoomId = useSelectedRoom();
  const location = useLocation();
  const lastVisitedRoom = useAtomValue(lastVisitedRoomAtom);

  if (selectedRoomId) return selectedRoomId;

  const section = resolveSection(location.pathname);
  const listMatch = section && matchPath({ path: section.listPath, end: true }, location.pathname);
  return listMatch ? lastVisitedRoom[section.key] : undefined;
};
