import { useSyncExternalStore } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { isDesktopTauri } from '$utils/platform';
import {
  EMPTY_SNAPSHOT,
  INITIAL_VOICE_STATE,
  type VoiceSnapshot,
  type VoiceState,
  type VoiceStatePayload,
} from './types';

// The voice store (AI/SPEC.md §5.5, §7). It is fed only by events from the Rust side;
// the UI never asks Mumble for state synchronously. Kept outside React and outside the
// Matrix stores on purpose: voice going down must not touch chat.

let state: VoiceState = INITIAL_VOICE_STATE;
const listeners = new Set<() => void>();

const setState = (patch: Partial<VoiceState>): void => {
  state = { ...state, ...patch };
  listeners.forEach((listener) => listener());
};

const applyStatePayload = (payload: VoiceStatePayload): void => {
  setState({
    status: payload.status,
    serverVersion: payload.serverVersion,
    error: payload.error,
    ...(payload.status === 'connected'
      ? {}
      : {
          snapshot: EMPTY_SNAPSHOT,
          pingMs: undefined,
          inputLevel: 0,
          transmitting: false,
          captureDevice: undefined,
          captureError: undefined,
        }),
  });
};

type CapturePayload = { deviceName?: string; error?: string };

export type InputDevice = { id: string; name: string; isDefault: boolean };

export type TransmitSettings = {
  mode: 'ptt' | 'vad' | 'continuous';
  vadThreshold: number;
  /** '' for the system default. */
  inputDevice: string;
};

let bridge: Promise<UnlistenFn[]> | undefined;

/** Start listening to the Mumble bridge. Safe to call more than once. */
export function startVoiceBridge(): void {
  if (bridge || !isDesktopTauri()) return;
  bridge = Promise.all([
    listen<VoiceStatePayload>('mumble://state', (event) => applyStatePayload(event.payload)),
    listen<VoiceSnapshot>('mumble://snapshot', (event) => setState({ snapshot: event.payload })),
    listen<{ pingMs: number }>('mumble://stats', (event) =>
      setState({ pingMs: event.payload.pingMs })
    ),
    listen<{ input: number; transmitting: boolean }>('audio://levels', (event) =>
      setState({ inputLevel: event.payload.input, transmitting: event.payload.transmitting })
    ),
    listen<CapturePayload>('audio://capture', (event) =>
      setState({ captureDevice: event.payload.deviceName, captureError: event.payload.error })
    ),
  ]);
  // Events are not replayed, so a freshly loaded webview asks once for where things stand.
  invoke<{
    state: VoiceStatePayload;
    snapshot: VoiceSnapshot;
    pingMs?: number;
    capture?: CapturePayload;
  }>('mumble_get_state')
    .then((full) => {
      applyStatePayload(full.state);
      if (full.state.status === 'connected') {
        setState({
          snapshot: full.snapshot,
          pingMs: full.pingMs,
          captureDevice: full.capture?.deviceName,
          captureError: full.capture?.error,
        });
      }
    })
    .catch(() => {
      // An older native build without the Mumble commands: voice simply stays off.
    });
}

const pinKey = (host: string, port: number): string => `kolpak:mumble:pin:${host}:${port}`;

const readPin = (host: string, port: number): string | undefined => {
  try {
    return localStorage.getItem(pinKey(host, port)) ?? undefined;
  } catch {
    return undefined;
  }
};

const writePin = (host: string, port: number, fingerprint: string): void => {
  try {
    localStorage.setItem(pinKey(host, port), fingerprint);
  } catch {
    // Without storage every connection is a first use; nothing else to do here.
  }
};

export type VoiceTarget = {
  host: string;
  port: number;
  username: string;
};

/**
 * Connect to the Mumble server. The server's certificate fingerprint is remembered the
 * first time and required to match after that (trust on first use).
 */
export async function connectVoice({ host, port, username }: VoiceTarget): Promise<void> {
  if (!isDesktopTauri()) return;
  startVoiceBridge();
  try {
    const connected = await invoke<{ fingerprint: string; pinned: boolean }>('mumble_connect', {
      args: { host, port, username, pinnedFingerprint: readPin(host, port) },
    });
    if (!connected.pinned) writePin(host, port, connected.fingerprint);
  } catch (error) {
    // The bridge also emits a state event; this covers failures before it could.
    setState({ status: 'disconnected', error: String(error), snapshot: EMPTY_SNAPSHOT });
  }
}

/**
 * Hand the transmit settings to the native side. They apply at once when connected
 * (changing the microphone reopens it) and are kept for the next connection.
 */
export async function applyTransmitSettings(settings: TransmitSettings): Promise<void> {
  if (!isDesktopTauri()) return;
  await invoke('mumble_set_transmit', {
    args: {
      mode: settings.mode,
      vadThreshold: settings.vadThreshold,
      inputDevice: settings.inputDevice || null,
    },
  }).catch(() => undefined);
}

/** Tell the native side whether the push-to-talk key is held. */
export function setPushToTalk(down: boolean): void {
  if (!isDesktopTauri()) return;
  void invoke('mumble_ptt', { down }).catch(() => undefined);
}

export async function listInputDevices(): Promise<InputDevice[]> {
  if (!isDesktopTauri()) return [];
  return invoke<InputDevice[]>('audio_list_input_devices').catch(() => []);
}

export async function disconnectVoice(): Promise<void> {
  if (!isDesktopTauri()) return;
  await invoke('mumble_disconnect').catch(() => undefined);
}

const subscribe = (listener: () => void): (() => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

const getState = (): VoiceState => state;

export function useVoice(): VoiceState {
  return useSyncExternalStore(subscribe, getState);
}
