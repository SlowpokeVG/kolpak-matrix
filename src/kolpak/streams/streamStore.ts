import { useSyncExternalStore } from 'react';

// Which stream channel the dock shows, and the player's volume. Per device, in
// localStorage, like the dock's open state.

import type { PlayableProtocol } from './stats';

const CHANNEL_KEY = 'kolpak:stream:channel';
const VOLUME_KEY = 'kolpak:stream:volume';
const FORMAT_KEY = 'kolpak:stream:format';

const read = (key: string): string | null => {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
};

const write = (key: string, value: string): void => {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Without storage the choice lasts until the app closes.
  }
};

let channel: string | null = read(CHANNEL_KEY);
const storedFormat = read(FORMAT_KEY);
let format: PlayableProtocol | null =
  storedFormat === 'flv' || storedFormat === 'hls' ? storedFormat : null;
const listeners = new Set<() => void>();

export function selectStreamChannel(name: string): void {
  if (name === channel) return;
  channel = name;
  write(CHANNEL_KEY, name);
  listeners.forEach((listener) => listener());
}

const subscribe = (listener: () => void): (() => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

const getChannel = (): string | null => channel;
const getFormat = (): PlayableProtocol | null => format;

/** The format picked in theater mode; it applies wherever a channel offers it. */
export function setPreferredProtocol(next: PlayableProtocol): void {
  if (next === format) return;
  format = next;
  write(FORMAT_KEY, next);
  listeners.forEach((listener) => listener());
}

export function usePreferredProtocol(): PlayableProtocol | null {
  return useSyncExternalStore(subscribe, getFormat);
}

/** The channel the user picked last, or null if they never picked one. */
export function useSelectedStreamChannel(): string | null {
  return useSyncExternalStore(subscribe, getChannel);
}

export function readStreamVolume(): number {
  const value = Number(read(VOLUME_KEY));
  return Number.isFinite(value) && value > 0 && value <= 1 ? value : 1;
}

export function saveStreamVolume(volume: number): void {
  // A muted or near-silent level is not worth remembering: the next stream would start mute.
  if (volume >= 0.05 && volume <= 1) write(VOLUME_KEY, String(volume));
}
