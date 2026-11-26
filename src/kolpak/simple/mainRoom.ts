import type { MatrixClient, Room } from '$types/matrix-sdk';

// Which room simple mode opens on start: the one the user picked, if they are still in it,
// else the busiest room they are in (most joined members), which in a one-community setup
// is the community's main chat. Spaces and rooms of two (direct chats) never count.

export function chatRooms(mx: MatrixClient): Room[] {
  return mx
    .getRooms()
    .filter(
      (room) =>
        room.getMyMembership() === 'join' && !room.isSpaceRoom() && room.getJoinedMemberCount() > 2
    );
}

export function resolveMainRoom(mx: MatrixClient, picked: string): string | undefined {
  const rooms = chatRooms(mx);
  if (picked && rooms.some((room) => room.roomId === picked)) return picked;
  let best: Room | undefined;
  for (const room of rooms) {
    if (!best || room.getJoinedMemberCount() > best.getJoinedMemberCount()) best = room;
  }
  return best?.roomId;
}
