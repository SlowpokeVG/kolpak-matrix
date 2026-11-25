import { describe, expect, it } from 'vitest';
import type { MatrixClient, MatrixEvent, Room } from '$types/matrix-sdk';
import { canGivePososat, mentionName, pososatContent } from './givePososat';

const room = (members: Record<string, string>, maySend = true) =>
  ({
    getMember: (userId: string) => (members[userId] ? { rawDisplayName: members[userId] } : null),
    maySendMessage: () => maySend,
  }) as unknown as Room;

const event = (sender: string | undefined, redacted = false) =>
  ({ getSender: () => sender, isRedacted: () => redacted }) as unknown as MatrixEvent;

const mx = { getUserId: () => '@me:klpq.io' } as unknown as MatrixClient;

describe('дать пососать', () => {
  it('is an emote that mentions the sender by name, like /me with a picked mention', () => {
    expect(pososatContent('@rebe:klpq.io', 'rebe')).toEqual({
      msgtype: 'm.emote',
      body: 'дал пососать rebe',
      format: 'org.matrix.custom.html',
      formatted_body: 'дал пососать <a href="https://matrix.to/#/@rebe:klpq.io">rebe</a>',
      'm.mentions': { user_ids: ['@rebe:klpq.io'] },
    });
  });

  it('escapes the name in the HTML but not in the plain body', () => {
    const content = pososatContent('@x:klpq.io', '<b>Шломо</b> & co');
    expect(content.body).toBe('дал пососать <b>Шломо</b> & co');
    expect(content.formatted_body).toBe(
      'дал пососать <a href="https://matrix.to/#/@x:klpq.io">&lt;b&gt;Шломо&lt;/b&gt; &amp; co</a>'
    );
  });

  it('names people as the room shows them, falling back to the ID', () => {
    const members = room({ '@shlomo:klpq.io': 'Шломо' });
    expect(mentionName(members, '@shlomo:klpq.io')).toBe('Шломо');
    expect(mentionName(members, '@nomad:klpq.io')).toBe('nomad');
  });

  it('is offered only on other people’s messages, in rooms we may post in', () => {
    expect(canGivePososat(mx, room({}), event('@rebe:klpq.io'))).toBe(true);
    expect(canGivePososat(mx, room({}), event('@me:klpq.io'))).toBe(false);
    expect(canGivePososat(mx, room({}), event('@rebe:klpq.io', true))).toBe(false);
    expect(canGivePososat(mx, room({}, false), event('@rebe:klpq.io'))).toBe(false);
    expect(canGivePososat(mx, room({}), event(undefined))).toBe(false);
  });
});
