import { useCallback, useSyncExternalStore } from 'react';
import type { MatrixEvent, Room } from '$types/matrix-sdk';
import { RoomEvent } from '$types/matrix-sdk';

// Read receipts beside messages, the way Element shows them: each person's avatar under the
// last message they have read. Replaces Sable's "… is following the conversation" line.
//
// One computation and one set of listeners per room, shared by every message on screen: a
// receipt or a new event recomputes the whole map once (batched), and each message reads its
// own entry. A receipt on something that is not drawn as a message (a reaction, an edit, a
// join) belongs to the last message before it, which is what that person has seen.

const MESSAGE_TYPES = new Set(['m.room.message', 'm.room.encrypted', 'm.sticker']);
const RECOMPUTE_DELAY_MS = 50;
const NONE: readonly string[] = [];

const isAnchor = (event: MatrixEvent): boolean => {
  const id = event.getId();
  if (!id || !id.startsWith('$')) return false;
  if (!MESSAGE_TYPES.has(event.getType())) return false;
  // Edits render inside the message they edit.
  return event.getRelation()?.rel_type !== 'm.replace';
};

/** Event ID → the people (not us) whose read receipt sits on it, in timeline order. */
export function computeReaders(
  events: readonly MatrixEvent[],
  readersAt: (event: MatrixEvent) => readonly string[],
  me: string | null
): Map<string, readonly string[]> {
  const map = new Map<string, string[]>();
  let anchor: string | undefined;
  for (const event of events) {
    if (isAnchor(event)) anchor = event.getId();
    if (!anchor) continue;
    const readers = readersAt(event).filter((userId) => userId !== me);
    if (readers.length === 0) continue;
    const list = map.get(anchor) ?? [];
    for (const userId of readers) if (!list.includes(userId)) list.push(userId);
    map.set(anchor, list);
  }
  return map;
}

type Entry = {
  map: Map<string, readonly string[]>;
  listeners: Set<() => void>;
  detach?: () => void;
  timer?: ReturnType<typeof setTimeout>;
};

const entries = new WeakMap<Room, Entry>();

const compute = (room: Room): Map<string, readonly string[]> =>
  computeReaders(
    room.getLiveTimeline().getEvents(),
    (event) => room.getUsersReadUpTo(event),
    room.client.getUserId()
  );

const entryOf = (room: Room): Entry => {
  let entry = entries.get(room);
  if (!entry) {
    entry = { map: compute(room), listeners: new Set() };
    entries.set(room, entry);
  }
  return entry;
};

const subscribe = (room: Room, listener: () => void): (() => void) => {
  const entry = entryOf(room);
  entry.listeners.add(listener);
  if (!entry.detach) {
    const recompute = () => {
      if (entry.timer) return;
      entry.timer = setTimeout(() => {
        entry.timer = undefined;
        entry.map = compute(room);
        entry.listeners.forEach((notify) => notify());
      }, RECOMPUTE_DELAY_MS);
    };
    room.on(RoomEvent.Receipt, recompute);
    room.on(RoomEvent.Timeline, recompute);
    room.on(RoomEvent.LocalEchoUpdated, recompute);
    room.on(RoomEvent.Redaction, recompute);
    entry.detach = () => {
      room.removeListener(RoomEvent.Receipt, recompute);
      room.removeListener(RoomEvent.Timeline, recompute);
      room.removeListener(RoomEvent.LocalEchoUpdated, recompute);
      room.removeListener(RoomEvent.Redaction, recompute);
      if (entry.timer) clearTimeout(entry.timer);
      entry.timer = undefined;
    };
  }
  return () => {
    entry.listeners.delete(listener);
    if (entry.listeners.size === 0) {
      entry.detach?.();
      entry.detach = undefined;
    }
  };
};

/** The people (not us) whose last read message is `eventId`. */
export function useEventReaders(room: Room, eventId: string | undefined): readonly string[] {
  const subscribeRoom = useCallback((listener: () => void) => subscribe(room, listener), [room]);
  const getSnapshot = useCallback(
    () => (eventId ? (entryOf(room).map.get(eventId) ?? NONE) : NONE),
    [room, eventId]
  );
  return useSyncExternalStore(subscribeRoom, getSnapshot);
}
