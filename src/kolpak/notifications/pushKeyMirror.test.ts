import { EventEmitter } from 'events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MatrixClient } from '$types/matrix-sdk';
import { ClientEvent } from '$types/matrix-sdk';
import { isRoomKeyMessage, startPushKeyMirror } from './pushKeyMirror';

const commands = vi.hoisted(() => ({
  kolpakPushKeysImport: vi.fn<(params: unknown) => Promise<number>>(async () => 1),
  kolpakPushKeysWipe: vi.fn<(params: unknown) => Promise<void>>(async () => undefined),
}));
vi.mock('$generated/tauri/commands', () => commands);

function fakeClient() {
  const emitter = new EventEmitter();
  const exportRoomKeysAsJson = vi.fn<() => Promise<string>>(async () => '[]');
  const mx = Object.assign(emitter, {
    getUserId: () => '@me:example.org',
    getDeviceId: () => 'PHONE',
    getCrypto: () => ({ exportRoomKeysAsJson }),
  }) as unknown as MatrixClient;
  return { mx, emitter, exportRoomKeysAsJson };
}

const setVisibility = (state: DocumentVisibilityState) => {
  Object.defineProperty(document, 'visibilityState', { value: state, configurable: true });
  document.dispatchEvent(new Event('visibilitychange'));
};

describe('push key mirror', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    commands.kolpakPushKeysImport.mockClear();
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
    const { mx, emitter } = fakeClient();
    const mirror = startPushKeyMirror(mx);

    await vi.advanceTimersByTimeAsync(20_000);
    expect(commands.kolpakPushKeysImport).toHaveBeenCalledTimes(1);
    expect(commands.kolpakPushKeysImport).toHaveBeenCalledWith({
      userId: '@me:example.org',
      deviceId: 'PHONE',
      keysJson: '[]',
    });

    // Too soon after the last copy: waits, then copies.
    setVisibility('hidden');
    await vi.advanceTimersByTimeAsync(1_000);
    expect(commands.kolpakPushKeysImport).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(commands.kolpakPushKeysImport).toHaveBeenCalledTimes(2);

    emitter.emit(ClientEvent.ReceivedToDeviceMessage, { message: { type: 'm.room_key' } });
    emitter.emit(ClientEvent.ReceivedToDeviceMessage, { message: { type: 'm.room_key' } });
    emitter.emit(ClientEvent.ReceivedToDeviceMessage, { message: { type: 'm.dummy' } });
    await vi.advanceTimersByTimeAsync(5_000);
    expect(commands.kolpakPushKeysImport).toHaveBeenCalledTimes(3);

    mirror.stop();
    emitter.emit(ClientEvent.ReceivedToDeviceMessage, { message: { type: 'm.room_key' } });
    setVisibility('hidden');
    await vi.advanceTimersByTimeAsync(20 * 60_000);
    expect(commands.kolpakPushKeysImport).toHaveBeenCalledTimes(3);
  });
});
