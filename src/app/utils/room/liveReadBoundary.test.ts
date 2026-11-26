import { describe, expect, it } from 'vitest';
import type { IPushRule, MatrixClient, Room } from '$types/matrix-sdk';
import { EventType, MatrixEvent, PushRuleActionName } from '$types/matrix-sdk';
import { liveReadBoundary } from './unread';

const ME = '@me:example.org';
const BOT = '@bot:example.org';

let counter = 0;
const event = (sender: string, content: Record<string, unknown>, type = 'm.room.message') =>
  new MatrixEvent({ type, sender, content, event_id: `$e${(counter += 1)}`, room_id: '!r' });

const text = (sender: string, body: string) => event(sender, { msgtype: 'm.text', body });
const notice = (body: string) => event(BOT, { msgtype: 'm.notice', body });
const edit = (target: MatrixEvent, body: string) =>
  event(BOT, {
    msgtype: 'm.notice',
    body: `* ${body}`,
    'm.new_content': { msgtype: 'm.notice', body },
    'm.relates_to': { rel_type: 'm.replace', event_id: target.getId() },
  });

const rule = (rule_id: string, notify = true): IPushRule => ({
  rule_id,
  default: true,
  enabled: true,
  actions: [notify ? PushRuleActionName.Notify : PushRuleActionName.DontNotify],
});

function room(
  events: MatrixEvent[],
  unread: number,
  {
    messageRule = rule('.m.rule.message'),
    roomRule,
  }: { messageRule?: IPushRule; roomRule?: IPushRule } = {}
): Room {
  const pushRules = new MatrixEvent({
    type: EventType.PushRules,
    content: { global: { override: [], underride: [messageRule, rule('.m.rule.encrypted')] } },
  });
  const client = {
    getUserId: () => ME,
    getAccountData: (type: string) => (type === EventType.PushRules ? pushRules : undefined),
    getRoomPushRule: () => roomRule,
  } as unknown as MatrixClient;
  return {
    roomId: '!r',
    client,
    getRoomUnreadNotificationCount: () => unread,
    getLiveTimeline: () => ({ getEvents: () => events }),
    findEventById: (id: string) => events.find((candidate) => candidate.getId() === id),
  } as unknown as Room;
}

describe('liveReadBoundary', () => {
  it('puts the boundary just before the unread message behind a pile of edits', () => {
    const activity = notice('Mumble activity');
    const before = edit(activity, 'change 1');
    const events = [
      before,
      edit(activity, 'change 2'),
      text(BOT, 'new'),
      edit(activity, 'change 3'),
    ];
    expect(liveReadBoundary(room(events, 1))).toBe(events[1]?.getId());
  });

  it('says nothing is unread when the server counts nothing (bot notices, edits)', () => {
    const activity = notice('Mumble activity');
    expect(liveReadBoundary(room([edit(activity, 'a'), notice('Live streams')], 0))).toBeNull();
  });

  it('needs no jump when the first unread message is the oldest one loaded', () => {
    expect(liveReadBoundary(room([text(BOT, 'only one loaded')], 1))).toBeNull();
  });

  it('keeps the jump when unread messages may lie beyond the loaded window', () => {
    expect(liveReadBoundary(room([text(BOT, 'a'), text(BOT, 'b')], 3))).toBeUndefined();
  });

  it('keeps the jump when there are more unread messages than fit on a screen', () => {
    const events = Array.from({ length: 12 }, (_, i) => text(BOT, `m${i}`));
    expect(liveReadBoundary(room([text(ME, 'mine'), ...events], 12))).toBeUndefined();
  });

  it('stops at my own message: everything before it is read', () => {
    const mine = text(ME, 'mine');
    expect(liveReadBoundary(room([text(BOT, 'old'), mine, text(BOT, 'new')], 1))).toBe(
      mine.getId()
    );
  });

  it('does not trust the count when ordinary messages do not notify', () => {
    const events = [text(BOT, 'a'), text(BOT, 'b')];
    expect(
      liveReadBoundary(room(events, 0, { messageRule: rule('.m.rule.message', false) }))
    ).toBeUndefined();
    expect(liveReadBoundary(room(events, 1, { roomRule: rule('!r', false) }))).toBeUndefined();
  });
});
