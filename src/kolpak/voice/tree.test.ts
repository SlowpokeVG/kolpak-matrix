import { describe, expect, it } from 'vitest';
import { buildTreeRows } from './tree';
import type { VoiceChannel, VoiceSnapshot, VoiceUser } from './types';

const channel = (id: number, parent: number | null, name: string): VoiceChannel => ({
  id,
  parent,
  name,
  position: 0,
  temporary: false,
  maxUsers: 0,
});

const user = (
  session: number,
  name: string,
  channelId: number,
  flags: Partial<VoiceUser> = {}
): VoiceUser => ({
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
  ...flags,
});

const snapshot: VoiceSnapshot = {
  session: 3,
  channels: [
    channel(0, null, 'Root'),
    channel(1, 0, 'lobby'),
    channel(2, 1, 'nook'),
    channel(4, 0, 'films'),
  ],
  users: [
    user(1, 'amy', 1),
    user(2, 'bob', 2, { selfMute: true }),
    user(3, 'me', 1, { selfMute: true, selfDeaf: true }),
  ],
};

const describeRows = (rows: ReturnType<typeof buildTreeRows>): string[] =>
  rows.map((row) =>
    row.kind === 'channel'
      ? `${'  '.repeat(row.depth)}${row.collapsed ? '+' : '-'} ${row.name} ${row.userCount}${row.current ? ' *' : ''}`
      : `${'  '.repeat(row.depth)}${row.name}${row.state === 'open' ? '' : ` (${row.state})`}${row.self ? ' <me>' : ''}`
  );

describe('buildTreeRows', () => {
  it('lists channels as an outline with their users underneath', () => {
    expect(describeRows(buildTreeRows(snapshot, new Set()))).toEqual([
      '- Root 0',
      '  - lobby 2 *',
      '    amy',
      '    me (deafened) <me>',
      '    - nook 1',
      '      bob (muted)',
      '  - films 0',
    ]);
  });

  it('hides everything under a collapsed channel, however deep', () => {
    expect(describeRows(buildTreeRows(snapshot, new Set([1])))).toEqual([
      '- Root 0',
      '  + lobby 2 *',
      '  - films 0',
    ]);
    expect(describeRows(buildTreeRows(snapshot, new Set([0])))).toEqual(['+ Root 0']);
  });

  it('marks only channels with something inside as foldable', () => {
    const rows = buildTreeRows(snapshot, new Set());
    const foldable = rows.flatMap((row) =>
      row.kind === 'channel' ? [[row.name, row.foldable]] : []
    );
    expect(foldable).toEqual([
      ['Root', true],
      ['lobby', true],
      ['nook', true],
      ['films', false],
    ]);
  });

  it('is empty before any state has arrived', () => {
    expect(buildTreeRows({ session: null, channels: [], users: [] }, new Set())).toEqual([]);
  });
});
