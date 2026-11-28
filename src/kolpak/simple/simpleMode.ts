import { useSyncExternalStore } from 'react';

// Shlomo mode (AI/HANDOFF.md, "Simple mode"): the everyday layout, made of parts that can be
// switched one by one under one master switch, all on by default. One community, so fewer
// settings and none of the room-management actions; a messenger's look; a room list with
// avatars, the last message and its time; every chat in one list; no tab bar on a phone
// (its places in the ⋮ menu); and a main room that opens when the app starts.
//
// Per device, in Kolpak's own storage, like the voice settings. Classes on <html> switch the
// styles (simple.css, simpleTheme.css.ts): `kolpak-simple` for the look, `kolpak-simple-rows`
// for the room rows; <html> because the theme manager resets <body>'s classes whenever the
// theme changes.

export type SableSettingsSnapshot = {
  messageLayout: number;
  useRightBubbles: boolean;
  hideMembershipEvents: boolean;
  hideNickAvatarEvents: boolean;
  /** Added later: absent in a snapshot taken before the look set it (ShlomoLookSync). */
  alwaysInlineEditor?: boolean;
};

export type ShlomoPart =
  | 'look'
  | 'roomPreviews'
  | 'oneList'
  | 'noSpaceRail'
  | 'noTabs'
  | 'fewerSettings'
  | 'openMainRoom';

/** The parts in the order the settings list them, with what each one does. */
export const SHLOMO_PARTS: readonly { id: ShlomoPart; title: string; description: string }[] = [
  {
    id: 'look',
    title: 'Messenger look',
    description:
      'The system font, rounded corners, chat bubbles with yours on the right, no join/leave or name-change lines, the message field growing upwards beside its buttons.',
  },
  {
    id: 'roomPreviews',
    title: 'Room list with previews',
    description: 'Every room with its picture, the last message and its time.',
  },
  {
    id: 'oneList',
    title: 'All chats in one list',
    description:
      'The rooms of every space and the direct chats together, newest first, without the create and explore rows.',
  },
  {
    id: 'noSpaceRail',
    title: 'No column of spaces',
    description:
      'On a phone, the list of chats takes the whole width. Best with all chats in one list, where the rooms of spaces are.',
  },
  {
    id: 'noTabs',
    title: 'No bar at the bottom',
    description:
      'On a phone: the inbox, search, your account and the settings are in the ⋮ menu of the chat list.',
  },
  {
    id: 'fewerSettings',
    title: 'Fewer settings',
    description: 'Only the settings for everyday use; the rest come back when this is off.',
  },
  {
    id: 'openMainRoom',
    title: 'Open the main room on start',
    description: 'The room picked below, or the busiest one.',
  },
];

const ALL_PARTS: Record<ShlomoPart, boolean> = {
  look: true,
  roomPreviews: true,
  oneList: true,
  noSpaceRail: true,
  noTabs: true,
  fewerSettings: true,
  openMainRoom: true,
};

export type SimpleModeState = {
  /** The master switch. On by default. */
  enabled: boolean;
  parts: Record<ShlomoPart, boolean>;
  /** The room that opens on start, or '' for "the busiest room I am in". */
  mainRoomId: string;
  /**
   * Sable's own settings as they were before the look changed them, to put back. Present
   * exactly while the look is applied (ShlomoLookSync).
   */
  before?: SableSettingsSnapshot;
};

const STORAGE_KEY = 'kolpak:simple';
const LOOK_CLASS = 'kolpak-simple';
const ROWS_CLASS = 'kolpak-simple-rows';

const isSnapshot = (value: unknown): value is SableSettingsSnapshot => {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.messageLayout === 'number' &&
    typeof v.useRightBubbles === 'boolean' &&
    typeof v.hideMembershipEvents === 'boolean' &&
    typeof v.hideNickAvatarEvents === 'boolean' &&
    (v.alwaysInlineEditor === undefined || typeof v.alwaysInlineEditor === 'boolean')
  );
};

export function sanitizeSimpleMode(raw: unknown): SimpleModeState {
  const src = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const storedParts =
    src.parts && typeof src.parts === 'object' ? (src.parts as Record<string, unknown>) : {};
  const parts = { ...ALL_PARTS };
  (Object.keys(parts) as ShlomoPart[]).forEach((part) => {
    if (typeof storedParts[part] === 'boolean') parts[part] = storedParts[part];
  });
  return {
    // Kolpak: on unless switched off.
    enabled: src.enabled === undefined ? true : src.enabled === true,
    parts,
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

/** Whether a part is in effect: the master switch and the part's own. */
export const partOn = (current: SimpleModeState, part: ShlomoPart): boolean =>
  current.enabled && current.parts[part];

const applyClasses = (): void => {
  document.documentElement.classList.toggle(LOOK_CLASS, partOn(state, 'look'));
  document.documentElement.classList.toggle(ROWS_CLASS, partOn(state, 'roomPreviews'));
};
applyClasses();

export function updateSimpleMode(patch: Partial<SimpleModeState>): void {
  state = sanitizeSimpleMode({ ...state, ...patch });
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Without storage the choice lasts until the app closes.
  }
  applyClasses();
  listeners.forEach((listener) => listener());
}

export function setShlomoPart(part: ShlomoPart, on: boolean): void {
  updateSimpleMode({ parts: { ...state.parts, [part]: on } });
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

/** Whether a part of Shlomo mode is in effect. */
export function useShlomo(part: ShlomoPart): boolean {
  return partOn(useSimpleMode(), part);
}

/** Settings sections Shlomo mode keeps with "Fewer settings"; the rest are hidden. */
export const SIMPLE_SETTINGS_SECTIONS: readonly string[] = [
  'general',
  'appearance',
  'notifications',
  'voice',
  'devices',
  'about',
];
