import { atom } from 'jotai';

export type LastVisitedRoom = {
  /** Section key the room was open under (see `resolveSection`). */
  section: string;
  roomId: string;
};

// This is only used for mobile swipe gestures
// It is not particularly accurate and shouldn't be used for much else
// unless you plan major refractors
export const lastVisitedRoomAtom = atom<LastVisitedRoom | undefined>(undefined);
