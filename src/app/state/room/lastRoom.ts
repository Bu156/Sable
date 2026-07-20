import {
  atomWithLocalStorage,
  getLocalStorageItem,
  setLocalStorageItem,
} from '$state/utils/atomWithLocalStorage';

const LAST_VISITED_ROOM_KEY = 'sable.lastVisitedRoom';

const lastVisitedRoomBaseAtom = atomWithLocalStorage<Record<string, string>>(
  LAST_VISITED_ROOM_KEY,
  (key) => getLocalStorageItem<Record<string, string>>(key, {}),
  (key, value) => setLocalStorageItem(key, value)
);

export const lastVisitedRoomAtom = lastVisitedRoomBaseAtom;
