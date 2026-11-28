import type { ReactNode } from 'react';
import { Spinner } from 'folds';
import { useParams } from 'react-router';
import { useResolvedRoomIdOrAlias } from '$hooks/router/useResolvedRoomId';
import { IsDirectRoomProvider, DisplayedEventIdProvider, RoomProvider } from '$hooks/useRoom';
import { useMatrixClient } from '$hooks/useMatrixClient';
import { JoinBeforeNavigate } from '$features/join-before-navigate';
import { useSearchParamsViaServers } from '$hooks/router/useSearchParamsViaServers';
import { useHomeRooms } from './useHomeRooms';
import { useSetting } from '$state/hooks/settings';
import { settingsAtom } from '$state/settings';
import { useAtomValue } from 'jotai';
import { mDirectAtom } from '$state/mDirectList';
import { useShlomo } from '../../../../kolpak/simple/simpleMode';

export function HomeRouteRoomProvider({
  roomIdOrAlias: roomIdOrAliasProp,
  eventId: eventIdProp,
  children,
}: {
  roomIdOrAlias?: string;
  eventId?: string;
  children: ReactNode;
}) {
  const mx = useMatrixClient();
  const [isShowingAllRoomsInHome] = useSetting(settingsAtom, 'isShowingAllRoomsInHome');
  // Kolpak: simple mode opens every chat from the home list, direct chats included, so back
  // leads to that one list.
  const simple = useShlomo('oneList');
  const mDirects = useAtomValue(mDirectAtom);
  const rooms = useHomeRooms(false, simple);

  const { roomIdOrAlias: encodedRoomIdOrAlias, eventId: encodedEventId } = useParams();
  const roomIdOrAlias =
    roomIdOrAliasProp ?? (encodedRoomIdOrAlias && decodeURIComponent(encodedRoomIdOrAlias));
  const eventId = eventIdProp ?? (encodedEventId && decodeURIComponent(encodedEventId));
  const viaServers = useSearchParamsViaServers();
  const { roomId, resolving } = useResolvedRoomIdOrAlias(roomIdOrAlias);
  const room = mx.getRoom(roomId);

  if (resolving) return <Spinner variant="Secondary" size="600" />;

  if (!room || (!isShowingAllRoomsInHome && !rooms.includes(room.roomId))) {
    return (
      <JoinBeforeNavigate
        roomIdOrAlias={roomIdOrAlias!}
        eventId={eventId}
        viaServers={viaServers}
      />
    );
  }

  return (
    <RoomProvider key={room.roomId} value={room}>
      <IsDirectRoomProvider value={simple && mDirects.has(room.roomId)}>
        <DisplayedEventIdProvider value={eventId}>{children}</DisplayedEventIdProvider>
      </IsDirectRoomProvider>
    </RoomProvider>
  );
}
