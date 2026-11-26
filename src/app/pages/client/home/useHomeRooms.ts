import { useAtomValue } from 'jotai';
import { useMatrixClient } from '$hooks/useMatrixClient';
import { mDirectAtom } from '$state/mDirectList';
import { roomToParentsAtom } from '$state/room/roomToParents';
import { allRoomsAtom } from '$state/room-list/roomList';
import { useDirects, useOrphanRooms } from '$state/hooks/roomList';
import { useMemo } from 'react';

/**
 * `includeDirects` (Kolpak's simple mode): every chat in one list, the rooms of every space
 * and the direct chats too, like a messenger.
 */
export const useHomeRooms = (isShowingAllRoomsInHome?: boolean, includeDirects = false) => {
  const mx = useMatrixClient();
  const mDirects = useAtomValue(mDirectAtom);
  const roomToParents = useAtomValue(roomToParentsAtom);
  const rooms = useOrphanRooms(
    mx,
    allRoomsAtom,
    mDirects,
    roomToParents,
    isShowingAllRoomsInHome || includeDirects
  );
  const directs = useDirects(mx, allRoomsAtom, mDirects);
  return useMemo(
    () => (includeDirects ? [...rooms, ...directs] : rooms),
    [includeDirects, rooms, directs]
  );
};
