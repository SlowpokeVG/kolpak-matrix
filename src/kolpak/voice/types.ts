// Shapes of what the Mumble bridge sends (src-tauri/src/mumble.rs, crates/kolpak-mumble).

export type VoiceStatus = 'disconnected' | 'connecting' | 'connected';

export type VoiceChannel = {
  id: number;
  /** null only for the root channel. */
  parent: number | null;
  name: string;
  position: number;
  temporary: boolean;
  /** 0 means no limit. */
  maxUsers: number;
};

export type VoiceUser = {
  session: number;
  name: string;
  channelId: number;
  mute: boolean;
  deaf: boolean;
  suppress: boolean;
  selfMute: boolean;
  selfDeaf: boolean;
  registered: boolean;
  prioritySpeaker: boolean;
  recording: boolean;
};

export type VoiceSnapshot = {
  /** Our own session once the server has synced us. */
  session: number | null;
  /** Parents before children. */
  channels: VoiceChannel[];
  users: VoiceUser[];
};

export type VoiceStatePayload = {
  status: VoiceStatus;
  session?: number;
  serverVersion?: string;
  error?: string;
};

export type VoiceState = {
  status: VoiceStatus;
  serverVersion?: string;
  /** Why the last connection ended or failed. */
  error?: string;
  snapshot: VoiceSnapshot;
  pingMs?: number;
  /** RMS of the latest microphone frame, 0 to 1. */
  inputLevel: number;
  /** Whether our microphone is being sent right now. */
  transmitting: boolean;
  /** The microphone in use, once it has opened. */
  captureDevice?: string;
  /** Why the microphone could not be opened. */
  captureError?: string;
  /** RMS of the latest block played, 0 to 1. */
  outputLevel: number;
  /** The output device in use, once it has opened. */
  outputDevice?: string;
  /** Why the output device could not be opened. */
  outputError?: string;
  /** Sessions of the other people speaking right now. */
  talking: readonly number[];
  /** True while voice uses the low-delay UDP channel, false while it is tunnelled. */
  udp: boolean;
};

export const EMPTY_SNAPSHOT: VoiceSnapshot = { session: null, channels: [], users: [] };

export const INITIAL_VOICE_STATE: VoiceState = {
  status: 'disconnected',
  snapshot: EMPTY_SNAPSHOT,
  inputLevel: 0,
  transmitting: false,
  outputLevel: 0,
  talking: [],
  udp: false,
};

/** The channel we are in and how many people are in it, for the status bar. */
export function currentChannelSummary(
  snapshot: VoiceSnapshot
): { channel: string; users: number } | undefined {
  if (snapshot.session === null) return undefined;
  const me = snapshot.users.find((user) => user.session === snapshot.session);
  if (!me) return undefined;
  const channel = snapshot.channels.find((entry) => entry.id === me.channelId);
  if (!channel) return undefined;
  return {
    channel: channel.name,
    users: snapshot.users.filter((user) => user.channelId === me.channelId).length,
  };
}

export type SelfAudioState = { mute: boolean; deaf: boolean };

/** Our own mute and deafen flags as the server last reported them. */
export function selfAudioState(snapshot: VoiceSnapshot): SelfAudioState | undefined {
  const me = snapshot.users.find((user) => user.session === snapshot.session);
  if (!me) return undefined;
  return { mute: me.selfMute || me.selfDeaf, deaf: me.selfDeaf };
}

/**
 * What to ask the server for when a button is pressed. The rules are Mumble's own:
 * deafening always mutes, and unmuting always undeafens.
 */
export function toggleSelfMute(current: SelfAudioState): SelfAudioState {
  return current.mute ? { mute: false, deaf: false } : { mute: true, deaf: current.deaf };
}

export function toggleSelfDeaf(current: SelfAudioState): SelfAudioState {
  return current.deaf ? { mute: false, deaf: false } : { mute: true, deaf: true };
}
