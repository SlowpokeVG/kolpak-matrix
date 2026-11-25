import { describe, expect, it } from 'vitest';
import {
  currentChannelSummary,
  EMPTY_SNAPSHOT,
  selfAudioState,
  toggleSelfDeaf,
  toggleSelfMute,
  type VoiceSnapshot,
  type VoiceUser,
} from './types';

const user = (session: number, name: string, channelId: number): VoiceUser => ({
  session,
  name,
  channelId,
  mute: false,
  deaf: false,
  suppress: false,
  selfMute: false,
  selfDeaf: false,
  registered: false,
  prioritySpeaker: false,
  recording: false,
});

const snapshot: VoiceSnapshot = {
  session: 3,
  channels: [
    { id: 0, parent: null, name: 'Root', position: 0, temporary: false, maxUsers: 0 },
    { id: 4, parent: 0, name: 'lobby', position: 0, temporary: false, maxUsers: 0 },
  ],
  users: [user(1, 'amy', 4), user(2, 'bob', 0), user(3, 'me', 4)],
};

describe('currentChannelSummary', () => {
  it('names our channel and counts everyone in it, ourselves included', () => {
    expect(currentChannelSummary(snapshot)).toEqual({ channel: 'lobby', users: 2 });
  });

  it('is undefined before the server has synced us', () => {
    expect(currentChannelSummary(EMPTY_SNAPSHOT)).toBeUndefined();
    expect(currentChannelSummary({ ...snapshot, session: null })).toBeUndefined();
  });

  it('is undefined when our own user or channel is missing from the snapshot', () => {
    expect(currentChannelSummary({ ...snapshot, session: 99 })).toBeUndefined();
    expect(
      currentChannelSummary({ ...snapshot, channels: [snapshot.channels[0]!] })
    ).toBeUndefined();
  });
});

describe('self mute and deafen', () => {
  it('reads our own flags, treating deafened as muted', () => {
    expect(selfAudioState(snapshot)).toEqual({ mute: false, deaf: false });
    const deafened: VoiceSnapshot = {
      ...snapshot,
      users: snapshot.users.map((entry) =>
        entry.session === 3 ? { ...entry, selfDeaf: true } : entry
      ),
    };
    expect(selfAudioState(deafened)).toEqual({ mute: true, deaf: true });
    expect(selfAudioState(EMPTY_SNAPSHOT)).toBeUndefined();
  });

  it('follows Mumble: deafening mutes, unmuting undeafens', () => {
    expect(toggleSelfMute({ mute: false, deaf: false })).toEqual({ mute: true, deaf: false });
    expect(toggleSelfMute({ mute: true, deaf: false })).toEqual({ mute: false, deaf: false });
    expect(toggleSelfMute({ mute: true, deaf: true })).toEqual({ mute: false, deaf: false });
    expect(toggleSelfDeaf({ mute: false, deaf: false })).toEqual({ mute: true, deaf: true });
    expect(toggleSelfDeaf({ mute: true, deaf: false })).toEqual({ mute: true, deaf: true });
    expect(toggleSelfDeaf({ mute: true, deaf: true })).toEqual({ mute: false, deaf: false });
  });
});
