import { useSyncExternalStore } from 'react';

// Simple mode (AI/HANDOFF.md, "Simple mode"): the everyday layout. One community, so fewer
// settings and none of the room-management actions; chat in the system's own sans-serif with
// Telegram-like bubbles; a room list with avatars, the last message and its time; and a main
// room that opens when the app starts.
//
// Per device, in Kolpak's own storage, like the voice settings. The class `kolpak-simple` on
// <html> switches the styles (simple.css); <html> because the theme manager resets <body>'s
// classes whenever the theme changes.

export type SableSettingsSnapshot = {
  messageLayout: number;
  useRightBubbles: boolean;
  hideMembershipEvents: boolean;
  hideNickAvatarEvents: boolean;
};

export type SimpleModeState = {
  enabled: boolean;
  /** The room that opens on start, or '' for "the busiest room I am in". */
  mainRoomId: string;
  /** Sable's own settings as they were before simple mode changed them, to put back. */
  before?: SableSettingsSnapshot;
};

const STORAGE_KEY = 'kolpak:simple';
const HTML_CLASS = 'kolpak-simple';

const isSnapshot = (value: unknown): value is SableSettingsSnapshot => {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.messageLayout === 'number' &&
    typeof v.useRightBubbles === 'boolean' &&
    typeof v.hideMembershipEvents === 'boolean' &&
    typeof v.hideNickAvatarEvents === 'boolean'
  );
};

export function sanitizeSimpleMode(raw: unknown): SimpleModeState {
  const src = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  return {
    enabled: src.enabled === true,
    mainRoomId: typeof src.mainRoomId === 'string' ? src.mainRoomId : '',
    ...(isSnapshot(src.before) ? { before: src.before } : {}),
  };
}

const read = (): SimpleModeState => {
  try {
    return sanitizeSimpleMode(JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}'));
  } catch {
    return sanitizeSimpleMode({});
  }
};

let state: SimpleModeState = read();
const listeners = new Set<() => void>();

const applyClass = (): void => {
  document.documentElement.classList.toggle(HTML_CLASS, state.enabled);
};
applyClass();

export function updateSimpleMode(patch: Partial<SimpleModeState>): void {
  state = sanitizeSimpleMode({ ...state, ...patch });
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Without storage the choice lasts until the app closes.
  }
  applyClass();
  listeners.forEach((listener) => listener());
}

const subscribe = (listener: () => void): (() => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

const getState = (): SimpleModeState => state;

export function getSimpleMode(): SimpleModeState {
  return state;
}

export function useSimpleMode(): SimpleModeState {
  return useSyncExternalStore(subscribe, getState);
}

/** Settings sections simple mode keeps; the rest are hidden while it is on. */
export const SIMPLE_SETTINGS_SECTIONS: readonly string[] = [
  'general',
  'appearance',
  'notifications',
  'voice',
  'devices',
  'about',
];
