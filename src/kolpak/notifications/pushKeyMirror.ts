import { addPluginListener } from '@tauri-apps/api/core';
import {
  kolpakPushKeysAppReport,
  kolpakPushKeysCheck,
  kolpakPushKeysImport,
  kolpakPushKeysKnown,
  kolpakPushKeysWipe,
  kolpakNotifySync,
} from '$generated/tauri/commands';
import type { MatrixClient, MatrixEvent } from '$types/matrix-sdk';
import { ClientEvent, EventType } from '$types/matrix-sdk';
import { createLogger } from '$utils/debug';

// Kolpak, Android: a copy of the room keys for the native push path (src-tauri/src/push_keys.rs).
//
// The room keys live in the webview's crypto store, which the push service cannot read, and
// while the app is in the background the webview barely runs. So the push service decrypts
// with a copy of the keys of its own, which this keeps fresh: shortly after start, every time
// the app goes to the background, after new room keys arrive, and every few minutes while the
// app is open. Only keys the copy does not have yet are exported (an account with an Element
// key import holds tens of thousands, too many to export every few minutes on a phone).
// The room names go along: some homeservers leave them out of pushes.

const log = createLogger('kolpak:push-keys');

const START_DELAY_MS = 20_000;
const PERIOD_MS = 10 * 60_000;
const AFTER_NEW_KEYS_MS = 4_000;
/** Going to the background copies at once, but not more often than this. */
const MIN_GAP_MS = 30_000;
/** Room keys per hand-over. */
const BATCH = 2000;

const ENCRYPTED: string = EventType.RoomMessageEncrypted;

const ROOM_KEY_TYPES = new Set(['m.room_key', 'm.forwarded_room_key', 'm.room_key_bundle']);

export const isRoomKeyMessage = (type: unknown): boolean =>
  typeof type === 'string' && ROOM_KEY_TYPES.has(type);

/** The wasm OlmMachine inside matrix-js-sdk's RustCrypto (a private field, read with care). */
type KeyExporter = {
  exportRoomKeys: (predicate: (session: { sessionId: string }) => boolean) => Promise<string>;
};

const keyExporter = (crypto: unknown): KeyExporter | undefined => {
  const machine = (crypto as { olmMachine?: Partial<KeyExporter> } | undefined)?.olmMachine;
  return typeof machine?.exportRoomKeys === 'function' ? (machine as KeyExporter) : undefined;
};

export const roomNamesJson = (mx: MatrixClient): string =>
  JSON.stringify(
    Object.fromEntries(
      mx
        .getRooms()
        .filter((room) => room.getMyMembership() === 'join')
        .map((room) => [room.roomId, room.name])
    )
  );

type Mirror = { stop: () => void; copyNow: () => Promise<void> };

let active: Mirror | undefined;
const listeners = new Set<() => void>();

/** Called after every copy, for the settings screen. */
export function onPushKeysCopied(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Copy now (the settings screen's button); resolves when done, rejects with the error. */
export async function copyPushKeysNow(): Promise<void> {
  if (!active) throw new Error('not signed in');
  await active.copyNow();
}

/** What the app is running, reported with the background signs of life. */
export type MirrorOptions = { syncMode: () => string };

const HEARTBEAT_MS = 60_000;

export function startPushKeyMirror(
  mx: MatrixClient,
  options: MirrorOptions = { syncMode: () => 'unknown' }
): Mirror {
  const userId = mx.getUserId();
  const deviceId = mx.getDeviceId();
  if (!userId || !deviceId) return { stop: () => undefined, copyNow: async () => undefined };

  let stopped = false;
  let running: Promise<void> | undefined;
  let again = false;
  let lastAt = 0;
  let soon: number | undefined;
  let known: Set<string> | undefined;
  let sentNames: string | undefined;

  const copy = async (): Promise<void> => {
    const crypto = mx.getCrypto();
    if (!crypto) return;
    const started = performance.now();
    if (!known) {
      known = new Set(await kolpakPushKeysKnown({ userId, deviceId }).catch(() => []));
    }
    const seen = known;
    const exporter = keyExporter(crypto);
    let names: string | null = roomNamesJson(mx);
    if (names === sentNames) names = null;
    let added = 0;
    let offered = 0;
    let sessions = 0;
    // In batches, so the first copy of a big store does not cross the bridge in one piece.
    for (;;) {
      const fresh: string[] = [];
      const pending = exporter
        ? exporter.exportRoomKeys((session) => {
            if (fresh.length >= BATCH) return false;
            const id = session.sessionId;
            if (seen.has(id)) return false;
            fresh.push(id);
            return true;
          })
        : crypto.exportRoomKeysAsJson();
      // Batches one after another on purpose.
      // oxlint-disable-next-line no-await-in-loop
      const keysJson = await pending;
      if (stopped) return;
      if (exporter && fresh.length === 0 && names === null) break;
      // oxlint-disable-next-line no-await-in-loop
      const result = await kolpakPushKeysImport({
        userId,
        deviceId,
        keysJson,
        roomNamesJson: names,
      });
      if (names !== null) sentNames = names;
      names = null;
      fresh.forEach((id) => seen.add(id));
      added += result.added;
      offered += fresh.length;
      sessions = result.sessions;
      if (!exporter || fresh.length < BATCH) break;
    }
    log.log('copied room keys for notifications', {
      offered: exporter ? offered : 'all',
      added,
      sessions,
      ms: Math.round(performance.now() - started),
    });
  };

  const run = (): Promise<void> => {
    if (stopped) return Promise.resolve();
    if (running) {
      again = true;
      return running;
    }
    lastAt = Date.now();
    // The notification device (notifyDevice.ts) takes a light sync along, so its to-device
    // backlog stays short and its one-time keys topped up; nothing without one.
    void kolpakNotifySync({ userId }).catch(() => undefined);
    const current = copy();
    running = current
      .catch((error: unknown) => log.warn('copying room keys failed', error))
      .finally(() => {
        running = undefined;
        listeners.forEach((listener) => listener());
        if (again) {
          again = false;
          void run().catch(() => undefined);
        }
      });
    return current;
  };

  const runSoon = (delay: number): void => {
    if (soon !== undefined) return;
    soon = window.setTimeout(() => {
      soon = undefined;
      void run().catch(() => undefined);
    }, delay);
  };

  const hidden = (): boolean => document.visibilityState === 'hidden';

  // Signs of life for the settings screen: whether the app runs at all in the background,
  // and whether pushes reach it there (the push path cannot tell).
  const report = (event: 'background' | 'push'): void => {
    void kolpakPushKeysAppReport({
      userId,
      deviceId,
      syncMode: options.syncMode(),
      event,
    }).catch(() => undefined);
  };

  const onVisibility = (): void => {
    if (!hidden()) return;
    report('background');
    if (Date.now() - lastAt < MIN_GAP_MS) runSoon(MIN_GAP_MS);
    else void run().catch(() => undefined);
  };

  const onToDevice = (message: { message: { type?: unknown } }): void => {
    if (!isRoomKeyMessage(message.message.type)) return;
    // In the background a timer can wait a minute; a push may be waiting for this key now.
    if (hidden()) void run().catch(() => undefined);
    else runSoon(AFTER_NEW_KEYS_MS);
  };

  const first = window.setTimeout(() => void run().catch(() => undefined), START_DELAY_MS);
  const timer = window.setInterval(() => void run().catch(() => undefined), PERIOD_MS);
  const heartbeat = window.setInterval(() => {
    if (hidden()) report('background');
  }, HEARTBEAT_MS);
  document.addEventListener('visibilitychange', onVisibility);
  mx.on(ClientEvent.ReceivedToDeviceMessage, onToDevice);
  let unlistenPush: (() => void) | undefined;
  void addPluginListener('notifications', 'push-message', () => report('push'))
    .then((listener) => {
      if (stopped) void listener.unregister();
      else unlistenPush = () => void listener.unregister();
    })
    .catch(() => undefined);

  const mirror: Mirror = {
    copyNow: () => run(),
    stop: () => {
      stopped = true;
      if (active === mirror) active = undefined;
      window.clearTimeout(first);
      window.clearInterval(timer);
      window.clearInterval(heartbeat);
      unlistenPush?.();
      if (soon !== undefined) window.clearTimeout(soon);
      document.removeEventListener('visibilitychange', onVisibility);
      mx.off(ClientEvent.ReceivedToDeviceMessage, onToDevice);
    },
  };
  active = mirror;
  return mirror;
}

/** The newest encrypted message from someone else that the app itself could read. */
export function latestReadableEncryptedEvent(mx: MatrixClient): MatrixEvent | undefined {
  const me = mx.getUserId();
  let best: MatrixEvent | undefined;
  mx.getRooms().forEach((room) => {
    const events = room.getLiveTimeline().getEvents();
    for (let i = events.length - 1; i >= 0; i -= 1) {
      const event = events[i];
      if (
        event &&
        event.getWireType() === ENCRYPTED &&
        event.getSender() !== me &&
        !event.isDecryptionFailure() &&
        !event.isBeingDecrypted()
      ) {
        if (!best || event.getTs() > best.getTs()) best = event;
        return;
      }
    }
  });
  return best;
}

export type PushCheck = { ok: boolean; detail: string };

/** Decrypt the newest encrypted message the way a push would be decrypted. */
export async function checkPushDecryption(mx: MatrixClient): Promise<PushCheck> {
  const userId = mx.getUserId();
  const deviceId = mx.getDeviceId();
  if (!userId || !deviceId) return { ok: false, detail: 'not signed in' };
  const event = latestReadableEncryptedEvent(mx);
  const roomId = event?.getRoomId();
  const eventId = event?.getId();
  if (!event || !roomId || !eventId) {
    return { ok: false, detail: 'no encrypted message from someone else loaded yet' };
  }
  const eventJson = JSON.stringify({
    type: EventType.RoomMessageEncrypted,
    room_id: roomId,
    content: event.getWireContent(),
    event_id: eventId,
    sender: event.getSender(),
    origin_server_ts: event.getTs(),
  });
  const result = await kolpakPushKeysCheck({ userId, deviceId, roomId, eventJson });
  const where = mx.getRoom(roomId)?.name ?? roomId;
  if (result.ok) return { ok: true, detail: `${where}: “${result.body ?? '(no text)'}”` };
  return { ok: false, detail: `${where}: ${result.error ?? 'unknown error'}` };
}

/** Forget the copy of an account's keys (logout). */
export async function wipePushKeys(userId: string, deviceId: string): Promise<void> {
  await kolpakPushKeysWipe({ userId, deviceId });
}
