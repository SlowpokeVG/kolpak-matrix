import { kolpakPushKeysImport, kolpakPushKeysWipe } from '$generated/tauri/commands';
import type { MatrixClient } from '$types/matrix-sdk';
import { ClientEvent } from '$types/matrix-sdk';
import { createLogger } from '$utils/debug';

// Kolpak, Android: a copy of the room keys for the native push path (src-tauri/src/push_keys.rs).
//
// The room keys live in the webview's crypto store, which the push service cannot read, and
// while the app is in the background the webview barely runs. So the push service decrypts
// with a copy of the keys of its own, which this keeps fresh: shortly after start, every time
// the app goes to the background, after new room keys arrive, and every few minutes while the
// app is open.

const log = createLogger('kolpak:push-keys');

const START_DELAY_MS = 20_000;
const PERIOD_MS = 10 * 60_000;
const AFTER_NEW_KEYS_MS = 4_000;
/** Going to the background copies at once, but not more often than this. */
const MIN_GAP_MS = 30_000;

const ROOM_KEY_TYPES = new Set(['m.room_key', 'm.forwarded_room_key', 'm.room_key_bundle']);

export const isRoomKeyMessage = (type: unknown): boolean =>
  typeof type === 'string' && ROOM_KEY_TYPES.has(type);

type Mirror = { stop: () => void };

export function startPushKeyMirror(mx: MatrixClient): Mirror {
  const userId = mx.getUserId();
  const deviceId = mx.getDeviceId();
  if (!userId || !deviceId) return { stop: () => undefined };

  let stopped = false;
  let running: Promise<void> | undefined;
  let again = false;
  let lastAt = 0;
  let soon: number | undefined;

  const copy = async (): Promise<void> => {
    const crypto = mx.getCrypto();
    if (!crypto) return;
    const started = performance.now();
    const keysJson = await crypto.exportRoomKeysAsJson();
    if (stopped) return;
    const imported = await kolpakPushKeysImport({ userId, deviceId, keysJson });
    log.log('copied room keys for notifications', {
      imported,
      ms: Math.round(performance.now() - started),
    });
  };

  const run = (): void => {
    if (stopped) return;
    if (running) {
      again = true;
      return;
    }
    lastAt = Date.now();
    running = copy()
      .catch((error: unknown) => log.warn('copying room keys failed', error))
      .finally(() => {
        running = undefined;
        if (again) {
          again = false;
          run();
        }
      });
  };

  const runSoon = (delay: number): void => {
    if (soon !== undefined) return;
    soon = window.setTimeout(() => {
      soon = undefined;
      run();
    }, delay);
  };

  const onVisibility = (): void => {
    if (document.visibilityState !== 'hidden') return;
    if (Date.now() - lastAt < MIN_GAP_MS) runSoon(MIN_GAP_MS);
    else run();
  };

  const onToDevice = (message: { message: { type?: unknown } }): void => {
    if (isRoomKeyMessage(message.message.type)) runSoon(AFTER_NEW_KEYS_MS);
  };

  const first = window.setTimeout(run, START_DELAY_MS);
  const timer = window.setInterval(run, PERIOD_MS);
  document.addEventListener('visibilitychange', onVisibility);
  mx.on(ClientEvent.ReceivedToDeviceMessage, onToDevice);

  return {
    stop: () => {
      stopped = true;
      window.clearTimeout(first);
      window.clearInterval(timer);
      if (soon !== undefined) window.clearTimeout(soon);
      document.removeEventListener('visibilitychange', onVisibility);
      mx.off(ClientEvent.ReceivedToDeviceMessage, onToDevice);
    },
  };
}

/** Forget the copy of an account's keys (logout). */
export async function wipePushKeys(userId: string, deviceId: string): Promise<void> {
  await kolpakPushKeysWipe({ userId, deviceId });
}
