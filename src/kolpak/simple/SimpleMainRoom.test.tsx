import { act, render } from '@testing-library/react';
import { createStore, Provider } from 'jotai';
import { MemoryRouter, useLocation } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { MatrixClient, Room } from '$types/matrix-sdk';

const rooms: Room[] = [];
const mx = {
  getRooms: () => rooms,
  getRoom: () => null,
} as unknown as MatrixClient;

vi.mock('$hooks/useMatrixClient', () => ({ useMatrixClient: () => mx }));
vi.mock('./simpleMode', () => ({ getSimpleMode: () => ({ enabled: true, mainRoomId: '' }) }));

const room = (roomId: string, members: number) =>
  ({
    roomId,
    getMyMembership: () => 'join',
    isSpaceRoom: () => false,
    getJoinedMemberCount: () => members,
    getCanonicalAlias: () => null,
  }) as unknown as Room;

let where = '';
function Where() {
  where = useLocation().pathname;
  return null;
}

describe('SimpleMainRoom', () => {
  afterEach(() => {
    vi.useRealTimers();
    rooms.length = 0;
  });

  it('opens the main room under Home once the rooms arrive, through re-renders', async () => {
    vi.useFakeTimers();
    const { SimpleMainRoom } = await import('./SimpleMainRoom');
    const { mDirectAtom } = await import('$state/mDirectList');
    const store = createStore();
    render(
      <Provider store={store}>
        <MemoryRouter initialEntries={['/home/']}>
          <SimpleMainRoom />
          <Where />
        </MemoryRouter>
      </Provider>
    );
    // The first sync is still running: nothing to open yet, and the direct chats fill in
    // meanwhile (that used to cancel the wait for good).
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000);
      store.set(mDirectAtom, { type: 'INITIALIZE', rooms: new Set(['!dm:x']) });
      await vi.advanceTimersByTimeAsync(1_000);
    });
    expect(where).toBe('/home/');

    rooms.push(room('!dm:x', 2), room('!main:x', 30));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(600);
    });
    expect(decodeURIComponent(where)).toBe('/home/!main:x');
  });
});
