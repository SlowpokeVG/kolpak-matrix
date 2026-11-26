import { useSyncExternalStore } from 'react';

// Voice settings. Kept in Kolpak's own storage rather than in Sable's settings atom: they
// are per device (a hotkey and a microphone mode do not belong in synced account data),
// and it keeps our footprint in Sable's settings code at zero.

export type TransmitMode = 'ptt' | 'vad' | 'continuous';

export type VoiceSettings = {
  host: string;
  port: number;
  /** The name shown to others on the Mumble server. */
  username: string;
  /** Join voice when the app starts. */
  autoConnect: boolean;
  transmitMode: TransmitMode;
  /** `KeyboardEvent.code` of the push-to-talk key, or '' when none is set. */
  pttKey: string;
  /** Input device ID from the native side, or '' for the system default. */
  inputDevice: string;
  /** Voice-activity threshold: RMS level, 0 to 1, above which the microphone opens. */
  vadThreshold: number;
  /** Output device ID from the native side, or '' for the system default. */
  outputDevice: string;
  /** Output volume, 0 to 2, where 1 leaves voices as they arrive. */
  outputVolume: number;
  /** Remove steady background noise from the microphone. */
  noiseSuppression: boolean;
  /**
   * Android: voice as a phone call (the phone's echo cancellation; loudspeaker, wired or
   * Bluetooth headset) rather than as media (no echo cancellation, Bluetooth headphones
   * keep their high-quality link). Ignored elsewhere.
   */
  callAudio: boolean;
};

export type StoredVoiceSettings = Partial<VoiceSettings>;

export type VoiceDefaults = Pick<VoiceSettings, 'host' | 'port' | 'username'>;

export const DEFAULT_MUMBLE_PORT = 64738;
export const TRANSMIT_MODES: readonly TransmitMode[] = ['ptt', 'vad', 'continuous'];
export const DEFAULT_VAD_THRESHOLD = 0.02;
/** The slider's range. Speech into a headset is usually between 0.02 and 0.3. */
export const MAX_VAD_THRESHOLD = 0.2;
export const MAX_OUTPUT_VOLUME = 2;

const STORAGE_KEY = 'kolpak:voice:settings';

const isPort = (value: unknown): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value > 0 && value < 65536;

/** Keep only well-formed fields; anything else falls back to its default. */
export function sanitizeStoredVoiceSettings(raw: unknown): StoredVoiceSettings {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const src = raw as Record<string, unknown>;
  const out: StoredVoiceSettings = {};
  if (typeof src.host === 'string') out.host = src.host;
  if (isPort(src.port)) out.port = src.port;
  if (typeof src.username === 'string') out.username = src.username;
  if (typeof src.autoConnect === 'boolean') out.autoConnect = src.autoConnect;
  if (TRANSMIT_MODES.includes(src.transmitMode as TransmitMode)) {
    out.transmitMode = src.transmitMode as TransmitMode;
  }
  if (typeof src.pttKey === 'string') out.pttKey = src.pttKey;
  if (typeof src.inputDevice === 'string') out.inputDevice = src.inputDevice;
  if (typeof src.vadThreshold === 'number' && src.vadThreshold >= 0 && src.vadThreshold <= 1) {
    out.vadThreshold = src.vadThreshold;
  }
  if (typeof src.outputDevice === 'string') out.outputDevice = src.outputDevice;
  if (
    typeof src.outputVolume === 'number' &&
    src.outputVolume >= 0 &&
    src.outputVolume <= MAX_OUTPUT_VOLUME
  ) {
    out.outputVolume = src.outputVolume;
  }
  if (typeof src.noiseSuppression === 'boolean') out.noiseSuppression = src.noiseSuppression;
  if (typeof src.callAudio === 'boolean') out.callAudio = src.callAudio;
  return out;
}

/** What the user saved, over what the app config and the Matrix account suggest. */
export function resolveVoiceSettings(
  stored: StoredVoiceSettings,
  defaults: VoiceDefaults
): VoiceSettings {
  return {
    host: stored.host?.trim() || defaults.host,
    port: stored.port ?? defaults.port,
    username: stored.username?.trim() || defaults.username,
    autoConnect: stored.autoConnect ?? false,
    transmitMode: stored.transmitMode ?? 'vad',
    pttKey: stored.pttKey ?? '',
    inputDevice: stored.inputDevice ?? '',
    vadThreshold: stored.vadThreshold ?? DEFAULT_VAD_THRESHOLD,
    outputDevice: stored.outputDevice ?? '',
    outputVolume: stored.outputVolume ?? 1,
    noiseSuppression: stored.noiseSuppression ?? true,
    callAudio: stored.callAudio ?? true,
  };
}

/** A key code as people read it: "KeyV" is "V", "Backquote" is "`". */
export function formatKeyCode(code: string): string {
  if (!code) return 'not set';
  if (/^Key[A-Z]$/.test(code)) return code.slice(3);
  if (/^Digit\d$/.test(code)) return code.slice(5);
  if (code.startsWith('Numpad')) return `Num ${code.slice(6)}`;
  const names: Record<string, string> = {
    Backquote: '`',
    Minus: '-',
    Equal: '=',
    BracketLeft: '[',
    BracketRight: ']',
    Backslash: '\\',
    Semicolon: ';',
    Quote: "'",
    Comma: ',',
    Period: '.',
    Slash: '/',
    Space: 'Space',
    CapsLock: 'Caps Lock',
    ControlLeft: 'Left Ctrl',
    ControlRight: 'Right Ctrl',
    ShiftLeft: 'Left Shift',
    ShiftRight: 'Right Shift',
    AltLeft: 'Left Alt',
    AltRight: 'Right Alt',
  };
  return names[code] ?? code;
}

const read = (): StoredVoiceSettings => {
  try {
    return sanitizeStoredVoiceSettings(JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}'));
  } catch {
    return {};
  }
};

let stored: StoredVoiceSettings = read();
const listeners = new Set<() => void>();

export function updateVoiceSettings(patch: StoredVoiceSettings): void {
  stored = sanitizeStoredVoiceSettings({ ...stored, ...patch });
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(stored));
  } catch {
    // Without storage the change lasts until the app closes.
  }
  listeners.forEach((listener) => listener());
}

const subscribe = (listener: () => void): (() => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

const getStored = (): StoredVoiceSettings => stored;

export function useStoredVoiceSettings(): StoredVoiceSettings {
  return useSyncExternalStore(subscribe, getStored);
}
