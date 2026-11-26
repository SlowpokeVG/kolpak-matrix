import { describe, expect, it } from 'vitest';
import type { MatrixClient, Room } from '$types/matrix-sdk';
import { resolveMainRoom } from './mainRoom';
import { sanitizeSimpleMode } from './simpleMode';

const room = (roomId: string, members: number, { space = false, membership = 'join' } = {}) =>
  ({
    roomId,
    getMyMembership: () => membership,
    isSpaceRoom: () => space,
    getJoinedMemberCount: () => members,
  }) as unknown as Room;

const client = (rooms: Room[]) => ({ getRooms: () => rooms }) as unknown as MatrixClient;

describe('resolveMainRoom', () => {
  const rooms = [
    room('!dm', 2),
    room('!small', 5),
    room('!main', 40),
    room('!space', 90, { space: true }),
    room('!left', 99, { membership: 'leave' }),
  ];

  it('takes the picked room while we are in it', () => {
    expect(resolveMainRoom(client(rooms), '!small')).toBe('!small');
  });

  it('falls back to the busiest chat room, never a space, a DM or a room we left', () => {
    expect(resolveMainRoom(client(rooms), '')).toBe('!main');
    expect(resolveMainRoom(client(rooms), '!left')).toBe('!main');
    expect(resolveMainRoom(client([room('!dm', 2)]), '')).toBeUndefined();
  });
});

describe('sanitizeSimpleMode', () => {
  it('keeps good fields and drops the rest', () => {
    expect(sanitizeSimpleMode({ enabled: true, mainRoomId: '!a', junk: 1 })).toEqual({
      enabled: true,
      mainRoomId: '!a',
    });
    expect(sanitizeSimpleMode('nope')).toEqual({ enabled: false, mainRoomId: '' });
    expect(
      sanitizeSimpleMode({
        before: {
          messageLayout: 0,
          useRightBubbles: false,
          hideMembershipEvents: false,
          hideNickAvatarEvents: true,
        },
      }).before?.messageLayout
    ).toBe(0);
  });
});
