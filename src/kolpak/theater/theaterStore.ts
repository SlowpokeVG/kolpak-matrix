import { useSyncExternalStore } from 'react';

// Theater mode (AI/DESIGN.md §4): on or off, and which Matrix room sits beside the stream.
// Not persisted: the app always starts in the normal layout.

type TheaterState = {
  open: boolean;
  /** The chat room in the right column; null means the room that was open on entering. */
  roomId: string | null;
};

let state: TheaterState = { open: false, roomId: null };
const listeners = new Set<() => void>();

const set = (next: TheaterState): void => {
  state = next;
  listeners.forEach((listener) => listener());
};

export function openTheater(): void {
  if (!state.open) set({ ...state, open: true });
}

export function closeTheater(): void {
  if (state.open) set({ open: false, roomId: null });
}

export function setTheaterRoom(roomId: string): void {
  if (state.roomId !== roomId) set({ ...state, roomId });
}

const subscribe = (listener: () => void): (() => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

const getState = (): TheaterState => state;

export function useTheater(): TheaterState {
  return useSyncExternalStore(subscribe, getState);
}
