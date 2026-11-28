import { EventEmitter } from 'events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MatrixClient } from '$types/matrix-sdk';
import { ClientEvent } from '$types/matrix-sdk';
import { copyPushKeysNow, isRoomKeyMessage, startPushKeyMirror } from './pushKeyMirror';

const commands = vi.hoisted(() => ({
  kolpakPushKeysImport: vi.fn<(params: unknown) => Promise<{ added: number; sessions: number }>>(
    async () => ({ added: 1, sessions: 1 })
  ),
  kolpakPushKeysKnown: vi.fn<(params: unknown) => Promise<string[]>>(async () => ['old']),
  kolpakPushKeysCheck: vi.fn<(params: unknown) => Promise<unknown>>(),
  kolpakPushKeysAppReport: vi.fn<(params: unknown) => Promise<void>>(async () => undefined),
  kolpakNotifySync: vi.fn<(params: unknown) => Promise<void>>(async () => undefined),
  kolpakPushKeysWipe: vi.fn<(params: unknown) => Promise<void>>(async () => undefined),
}));
vi.mock('$generated/tauri/commands', () => commands);
vi.mock('@tauri-apps/api/core', () => ({
  addPluginListener: vi.fn<() => Promise<{ unregister: () => Promise<void> }>>(async () => ({
    unregister: async () => undefined,
  })),
}));

type Session = { sessionId: string };

function fakeClient(sessions: string[] = []) {
  const emitter = new EventEmitter();
  const exportRoomKeysAsJson = vi.fn<() => Promise<string>>(async () => '[]');
  const exportRoomKeys = vi.fn<(predicate: (session: Session) => boolean) => Promise<string>>(
    async (predicate) => JSON.stringify(sessions.filter((sessionId) => predicate({ sessionId })))
  );
  const rooms = [{ roomId: '!r', name: 'TT', getMyMembership: () => 'join' }];
  const mx = Object.assign(emitter, {
    getUserId: () => '@me:example.org',
    getDeviceId: () => 'PHONE',
    getRooms: () => rooms,
    getCrypto: () => ({ exportRoomKeysAsJson, olmMachine: { exportRoomKeys } }),
  }) as unknown as MatrixClient;
  return { mx, emitter, exportRoomKeysAsJson, exportRoomKeys, sessions };
}

const setVisibility = (state: DocumentVisibilityState) => {
  Object.defineProperty(document, 'visibilityState', { value: state, configurable: true });
  document.dispatchEvent(new Event('visibilitychange'));
};

describe('push key mirror', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    commands.kolpakPushKeysImport.mockClear();
    commands.kolpakPushKeysKnown.mockClear();
  });
  afterEach(() => {
    vi.useRealTimers();
    setVisibility('visible');
  });

  it('knows room key messages', () => {
    expect(isRoomKeyMessage('m.room_key')).toBe(true);
    expect(isRoomKeyMessage('m.forwarded_room_key')).toBe(true);
    expect(isRoomKeyMessage('m.key.verification.request')).toBe(false);
    expect(isRoomKeyMessage(undefined)).toBe(false);
  });

  it('copies shortly after start, on going to the background and after new keys', async () => {
    const { mx, emitter, sessions } = fakeClient(['old', 'new']);
    const mirror = startPushKeyMirror(mx);

    await vi.advanceTimersByTimeAsync(20_000);
    expect(commands.kolpakPushKeysImport).toHaveBeenCalledTimes(1);
    // Only the key the copy does not have yet, and the room names the first time.
    expect(commands.kolpakPushKeysImport).toHaveBeenCalledWith({
      userId: '@me:example.org',
      deviceId: 'PHONE',
      keysJson: '["new"]',
      roomNamesJson: '{"!r":"TT"}',
    });
    sessions.push('newer');

    // Too soon after the last copy: waits, then copies; and the app notes it is in the background.
    setVisibility('hidden');
    expect(commands.kolpakPushKeysAppReport).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'background' })
    );
    await vi.advanceTimersByTimeAsync(1_000);
    expect(commands.kolpakPushKeysImport).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(commands.kolpakPushKeysImport).toHaveBeenLastCalledWith(
      expect.objectContaining({ keysJson: '["newer"]', roomNamesJson: null })
    );

    // Nothing new: nothing handed over.
    await copyPushKeysNow();
    expect(commands.kolpakPushKeysImport).toHaveBeenCalledTimes(2);

    sessions.push('newest');
    emitter.emit(ClientEvent.ReceivedToDeviceMessage, { message: { type: 'm.room_key' } });
    emitter.emit(ClientEvent.ReceivedToDeviceMessage, { message: { type: 'm.room_key' } });
    emitter.emit(ClientEvent.ReceivedToDeviceMessage, { message: { type: 'm.dummy' } });
    // In the background a new key goes over at once, not after a timer.
    await vi.advanceTimersByTimeAsync(10);
    expect(commands.kolpakPushKeysImport).toHaveBeenCalledTimes(3);

    mirror.stop();
    emitter.emit(ClientEvent.ReceivedToDeviceMessage, { message: { type: 'm.room_key' } });
    setVisibility('hidden');
    await vi.advanceTimersByTimeAsync(20 * 60_000);
    expect(commands.kolpakPushKeysImport).toHaveBeenCalledTimes(3);
  });

  it('hands a big store over in batches', async () => {
    const many = Array.from({ length: 4500 }, (_, i) => `s${i}`);
    const { mx } = fakeClient(many);
    commands.kolpakPushKeysKnown.mockResolvedValueOnce([]);
    const mirror = startPushKeyMirror(mx);
    await copyPushKeysNow();
    const sizes = commands.kolpakPushKeysImport.mock.calls.map(
      ([params]) => (JSON.parse((params as { keysJson: string }).keysJson) as string[]).length
    );
    expect(sizes).toEqual([2000, 2000, 500]);
    mirror.stop();
  });
});
