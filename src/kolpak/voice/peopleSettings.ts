import { useSyncExternalStore } from 'react';
import type { VoiceSnapshot } from './types';

// Per-person voice settings: how loud each person is for us, and whether we have muted
// them for ourselves (nobody else is affected). Kept by Mumble name, which is unique on a
// server at any one time and survives reconnects, unlike the session number. Names are
// compared without case, as Mumble does. Stored per device, like the other voice settings.

export type PersonSetting = {
  /** 0 to 2, where 1 leaves the voice as it arrives. */
  volume: number;
  /** Muted for us only. */
  muted: boolean;
};

export type PeopleSettings = Readonly<Record<string, PersonSetting>>;

export type UserGain = { session: number; gain: number };

export const DEFAULT_PERSON: PersonSetting = { volume: 1, muted: false };
export const MAX_PERSON_VOLUME = 2;

const STORAGE_KEY = 'kolpak:voice:people';

export const personKey = (name: string): string => name.trim().toLowerCase();

const isDefault = (setting: PersonSetting): boolean =>
  setting.volume === DEFAULT_PERSON.volume && setting.muted === DEFAULT_PERSON.muted;

/** Keep only well-formed entries that differ from the default. */
export function sanitizePeople(raw: unknown): PeopleSettings {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const out: Record<string, PersonSetting> = {};
  for (const [name, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!name.trim() || !value || typeof value !== 'object') continue;
    const src = value as Record<string, unknown>;
    const volume =
      typeof src.volume === 'number' && src.volume >= 0 && src.volume <= MAX_PERSON_VOLUME
        ? src.volume
        : DEFAULT_PERSON.volume;
    const muted = typeof src.muted === 'boolean' ? src.muted : DEFAULT_PERSON.muted;
    const setting = { volume, muted };
    if (!isDefault(setting)) out[personKey(name)] = setting;
  }
  return out;
}

export function personSetting(people: PeopleSettings, name: string): PersonSetting {
  return people[personKey(name)] ?? DEFAULT_PERSON;
}

/**
 * What the native mixer needs: a gain for each session on the server whose setting is not
 * the default, ourselves left out. Sorted, so equal sets compare equal.
 */
export function gainsFor(snapshot: VoiceSnapshot, people: PeopleSettings): UserGain[] {
  const gains: UserGain[] = [];
  for (const user of snapshot.users) {
    if (user.session === snapshot.session) continue;
    const setting = personSetting(people, user.name);
    const gain = setting.muted ? 0 : setting.volume;
    if (gain !== 1) gains.push({ session: user.session, gain });
  }
  return gains.toSorted((a, b) => a.session - b.session);
}

const read = (): PeopleSettings => {
  try {
    return sanitizePeople(JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}'));
  } catch {
    return {};
  }
};

let people: PeopleSettings = read();
const listeners = new Set<() => void>();

/** Change one person's setting; back at the default, they are forgotten. */
export function updatePerson(name: string, patch: Partial<PersonSetting>): void {
  const key = personKey(name);
  if (!key) return;
  people = sanitizePeople({ ...people, [key]: { ...personSetting(people, name), ...patch } });
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(people));
  } catch {
    // Without storage the change lasts until the app closes.
  }
  listeners.forEach((listener) => listener());
}

export function resetPerson(name: string): void {
  updatePerson(name, DEFAULT_PERSON);
}

export const getPeopleSettings = (): PeopleSettings => people;

export function subscribePeople(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function usePeopleSettings(): PeopleSettings {
  return useSyncExternalStore(subscribePeople, getPeopleSettings);
}
