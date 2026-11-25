import { describe, expect, it } from 'vitest';
import { gainsFor, personSetting, sanitizePeople } from './peopleSettings';
import type { VoiceSnapshot, VoiceUser } from './types';

const user = (session: number, name: string): VoiceUser => ({
  session,
  name,
  channelId: 0,
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
  session: 1,
  channels: [],
  users: [user(1, 'me'), user(7, 'Loud'), user(3, 'quiet'), user(9, 'troll'), user(4, 'normal')],
};

describe('per-person voice settings', () => {
  it('keeps well-formed entries by lower-case name and drops defaults and junk', () => {
    expect(
      sanitizePeople({
        Loud: { volume: 0.5, muted: false },
        quiet: { volume: 1.6 },
        same: { volume: 1, muted: false },
        bad: { volume: 7, muted: 'yes' },
        troll: { muted: true },
        '  ': { muted: true },
        nothing: null,
      })
    ).toEqual({
      loud: { volume: 0.5, muted: false },
      quiet: { volume: 1.6, muted: false },
      troll: { volume: 1, muted: true },
    });
    expect(sanitizePeople([1, 2])).toEqual({});
    expect(sanitizePeople('x')).toEqual({});
  });

  it('looks people up without case and falls back to the default', () => {
    const people = sanitizePeople({ loud: { volume: 0.5 } });
    expect(personSetting(people, 'LOUD')).toEqual({ volume: 0.5, muted: false });
    expect(personSetting(people, 'someone')).toEqual({ volume: 1, muted: false });
  });

  it('gives the mixer a gain per session, muted as zero, leaving out ourselves and defaults', () => {
    const people = sanitizePeople({
      loud: { volume: 0.5 },
      quiet: { volume: 1.6 },
      troll: { volume: 1.6, muted: true },
      me: { volume: 2 },
    });
    expect(gainsFor(snapshot, people)).toEqual([
      { session: 3, gain: 1.6 },
      { session: 7, gain: 0.5 },
      { session: 9, gain: 0 },
    ]);
    expect(gainsFor(snapshot, {})).toEqual([]);
  });
});
