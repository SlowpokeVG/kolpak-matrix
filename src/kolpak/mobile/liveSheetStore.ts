import { useSyncExternalStore } from 'react';

// Whether the live panel is open on a phone (MobileLive.tsx). Not persisted: the app starts
// with it closed. Its own module so that voice code can open it without importing the panel.

let sheetOpen = false;
const sheetListeners = new Set<() => void>();

export function setLiveSheetOpen(next: boolean): void {
  if (next === sheetOpen) return;
  sheetOpen = next;
  sheetListeners.forEach((listener) => listener());
}

const subscribeSheet = (listener: () => void): (() => void) => {
  sheetListeners.add(listener);
  return () => {
    sheetListeners.delete(listener);
  };
};

const getSheetOpen = (): boolean => sheetOpen;

export function useLiveSheetOpen(): boolean {
  return useSyncExternalStore(subscribeSheet, getSheetOpen);
}
