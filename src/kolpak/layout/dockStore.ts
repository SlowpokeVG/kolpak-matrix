import { useSyncExternalStore } from 'react';

// Whether the live dock is open. Open by default; it collapses to give chat the full width,
// and the choice persists (AI/DESIGN.md §3.4).

const STORAGE_KEY = 'kolpak:dock:open';

const read = (): boolean => {
  try {
    return localStorage.getItem(STORAGE_KEY) !== 'false';
  } catch {
    return true;
  }
};

let open = read();
const listeners = new Set<() => void>();

export function setDockOpen(next: boolean): void {
  if (next === open) return;
  open = next;
  try {
    localStorage.setItem(STORAGE_KEY, String(next));
  } catch {
    // Without storage the dock just starts closed next time.
  }
  listeners.forEach((listener) => listener());
}

export function toggleDock(): void {
  setDockOpen(!open);
}

const subscribe = (listener: () => void): (() => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

const getOpen = (): boolean => open;

export function useDockOpen(): boolean {
  return useSyncExternalStore(subscribe, getOpen);
}
