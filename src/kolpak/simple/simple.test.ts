import { describe, expect, it } from 'vitest';
import type { MatrixClient, Room } from '$types/matrix-sdk';
import { resolveMainRoom } from './mainRoom';
import { partOn, sanitizeSimpleMode } from './simpleMode';

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
  const allParts = {
    look: true,
    roomPreviews: true,
    oneList: true,
    noSpaceRail: true,
    twoTabs: true,
    fewerSettings: true,
    openMainRoom: true,
  };

  it('is on, with every part, when nothing is stored', () => {
    expect(sanitizeSimpleMode(undefined)).toEqual({
      enabled: true,
      parts: allParts,
      mainRoomId: '',
    });
    expect(sanitizeSimpleMode('nope')).toEqual({ enabled: true, parts: allParts, mainRoomId: '' });
  });

  it('keeps good fields and drops the rest', () => {
    expect(
      sanitizeSimpleMode({
        enabled: false,
        mainRoomId: '!a',
        parts: { look: false, twoTabs: 'yes', junk: true },
        junk: 1,
      })
    ).toEqual({
      enabled: false,
      parts: { ...allParts, look: false },
      mainRoomId: '!a',
    });
    expect(sanitizeSimpleMode({ enabled: 'yes' }).enabled).toBe(false);
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

  it('keeps a part off only while the master switch is on', () => {
    const state = sanitizeSimpleMode({ parts: { oneList: false } });
    expect(partOn(state, 'oneList')).toBe(false);
    expect(partOn(state, 'look')).toBe(true);
    expect(partOn({ ...state, enabled: false }, 'look')).toBe(false);
  });
});
