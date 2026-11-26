import { describe, expect, it } from 'vitest';
import { findChannelByPath, mumbleTargetFromHref, parseMumbleUrl, sameServer } from './mumbleLinks';
import type { VoiceSnapshot } from './types';

describe('parseMumbleUrl', () => {
  it('reads host and port', () => {
    expect(parseMumbleUrl('mumble://mumble.klpq.io:64738')).toEqual({
      host: 'mumble.klpq.io',
      port: 64738,
      channelPath: [],
    });
  });

  it('defaults the port and reads a channel path, name and query', () => {
    expect(
      parseMumbleUrl('mumble://pyro@mumble.klpq.io/Games/gay%20room%203/?version=1.2.0')
    ).toEqual({
      host: 'mumble.klpq.io',
      port: 64738,
      channelPath: ['Games', 'gay room 3'],
      username: 'pyro',
    });
  });

  it('rejects what is not a Mumble URL', () => {
    expect(parseMumbleUrl('https://mumble.klpq.io')).toBeUndefined();
    expect(parseMumbleUrl('mumble://')).toBeUndefined();
    expect(parseMumbleUrl('mumble://host:99999')).toBeUndefined();
  });
});

describe('mumbleTargetFromHref', () => {
  it("understands the bot's join page", () => {
    expect(
      mumbleTargetFromHref(
        'https://matrix-memes.klpq.io/join-mumble.html#mumble%3A%2F%2Fmumble.klpq.io%3A64738'
      )
    ).toEqual({ host: 'mumble.klpq.io', port: 64738, channelPath: [] });
  });

  it('accepts a plain or doubly encoded fragment and a bare mumble link', () => {
    expect(mumbleTargetFromHref('https://example.org/x#mumble://h:1234/A')).toEqual({
      host: 'h',
      port: 1234,
      channelPath: ['A'],
    });
    expect(mumbleTargetFromHref('https://example.org/#mumble%253A%252F%252Fh')?.host).toBe('h');
    expect(mumbleTargetFromHref('mumble://h')?.host).toBe('h');
  });

  it('leaves other links alone', () => {
    expect(mumbleTargetFromHref('https://matrix.to/#/#room:server')).toBeUndefined();
    expect(mumbleTargetFromHref('https://example.org/page#section')).toBeUndefined();
    expect(mumbleTargetFromHref('javascript:alert(1)#mumble://h')).toBeUndefined();
  });
});

describe('sameServer', () => {
  it('ignores case in the host and compares the port', () => {
    expect(
      sameServer({ host: 'Mumble.KLPQ.io', port: 1 }, { host: 'mumble.klpq.io', port: 1 })
    ).toBe(true);
    expect(sameServer({ host: 'a', port: 1 }, { host: 'a', port: 2 })).toBe(false);
    expect(sameServer(undefined, { host: 'a', port: 1 })).toBe(false);
  });
});

const channel = (id: number, parent: number | null, name: string) => ({
  id,
  parent,
  name,
  position: 0,
  temporary: false,
  maxUsers: 0,
});

describe('findChannelByPath', () => {
  const snapshot: VoiceSnapshot = {
    session: 1,
    channels: [channel(0, null, 'Root'), channel(1, 0, 'Games'), channel(2, 1, 'gay room 3')],
    users: [],
  };

  it('walks down from the root by name', () => {
    expect(findChannelByPath(snapshot, [])).toBe(0);
    expect(findChannelByPath(snapshot, ['games', 'GAY ROOM 3'])).toBe(2);
  });

  it('gives up on a missing step', () => {
    expect(findChannelByPath(snapshot, ['Games', 'nope'])).toBeUndefined();
  });
});
