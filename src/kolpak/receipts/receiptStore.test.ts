import { describe, expect, it } from 'vitest';
import type { MatrixEvent } from '$types/matrix-sdk';
import { computeReaders } from './receiptStore';

const event = (id: string, type = 'm.room.message', relType?: string) =>
  ({
    getId: () => id,
    getType: () => type,
    getRelation: () => (relType ? { rel_type: relType } : null),
  }) as unknown as MatrixEvent;

describe('computeReaders', () => {
  it('puts each reader under the message their receipt is on, not counting us', () => {
    const events = [event('$a'), event('$b'), event('$c')];
    const at: Record<string, string[]> = { $a: ['@x'], $c: ['@y', '@me'] };
    const map = computeReaders(events, (e) => at[e.getId()!] ?? [], '@me');
    expect(map.get('$a')).toEqual(['@x']);
    expect(map.get('$b')).toBeUndefined();
    expect(map.get('$c')).toEqual(['@y']);
  });

  it('moves receipts on reactions, edits and joins to the message before them', () => {
    const events = [
      event('$msg'),
      event('$react', 'm.reaction'),
      event('$edit', 'm.room.message', 'm.replace'),
      event('$join', 'm.room.member'),
    ];
    const at: Record<string, string[]> = { $react: ['@x'], $edit: ['@y'], $join: ['@x'] };
    const map = computeReaders(events, (e) => at[e.getId()!] ?? [], '@me');
    expect(map.get('$msg')).toEqual(['@x', '@y']);
  });

  it('ignores local echoes and anything before the first message', () => {
    const events = [event('$join', 'm.room.member'), event('~local')];
    const at: Record<string, string[]> = { $join: ['@x'], '~local': ['@y'] };
    expect(computeReaders(events, (e) => at[e.getId()!] ?? [], '@me').size).toBe(0);
  });
});
