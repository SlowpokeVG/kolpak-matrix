import type { MatrixEvent } from '$types/matrix-sdk';

// The second line of a room in the simple-mode room list: who wrote last and what, the way
// a messenger shows it. Pure, so it can be tested without a client.

/** Replies carry the quoted message at the top of their body; the preview skips it. */
const stripReplyFallback = (body: string): string => {
  if (!body.startsWith('> ')) return body;
  const lines = body.split('\n');
  const first = lines.findIndex((line) => !line.startsWith('>'));
  return first < 0 ? body : lines.slice(first).join('\n').trim();
};

const MEDIA: Record<string, string> = {
  'm.image': 'Photo',
  'm.video': 'Video',
  'm.audio': 'Audio',
  'm.location': 'Location',
};

/** What the event says, in one short line; undefined when there is nothing to show. */
export function previewText(event: MatrixEvent): string | undefined {
  if (event.isRedacted()) return 'Message deleted';
  const type = event.getType();
  if (type === 'm.room.encrypted') return 'Encrypted message';
  if (type === 'm.sticker') return 'Sticker';
  const content = event.getContent<{ msgtype?: string; body?: unknown }>();
  if (type === 'm.room.message') {
    const msgtype = content.msgtype ?? '';
    if (MEDIA[msgtype]) return MEDIA[msgtype];
    const body = typeof content.body === 'string' ? content.body : '';
    if (msgtype === 'm.file') return body ? `File: ${body}` : 'File';
    const text = stripReplyFallback(body).replace(/\s+/g, ' ').trim();
    return text || undefined;
  }
  if (type === 'm.room.member') return 'joined or left';
  if (type === 'm.room.name') return 'renamed the room';
  if (type === 'm.room.topic') return 'changed the topic';
  if (type === 'm.room.avatar') return 'changed the room picture';
  return undefined;
}

/** Whether the line should start with the sender (not for emotes, member changes and such). */
export function previewHasSender(event: MatrixEvent): boolean {
  if (event.getType() !== 'm.room.message' && event.getType() !== 'm.sticker') return false;
  return event.getContent<{ msgtype?: string }>().msgtype !== 'm.emote';
}

const pad = (value: number) => String(value).padStart(2, '0');

/** Time of day today, the weekday this week, else the date. */
export function previewTime(ts: number, now = Date.now(), hour24 = true): string {
  const date = new Date(ts);
  const today = new Date(now);
  const sameDay = date.toDateString() === today.toDateString();
  if (sameDay) {
    if (hour24) return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
    return date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  }
  const startOfToday = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
  if (ts > startOfToday - 6 * 24 * 60 * 60 * 1000) {
    return date.toLocaleDateString(undefined, { weekday: 'short' });
  }
  const sameYear = date.getFullYear() === today.getFullYear();
  return sameYear
    ? `${pad(date.getDate())}.${pad(date.getMonth() + 1)}`
    : `${pad(date.getDate())}.${pad(date.getMonth() + 1)}.${String(date.getFullYear()).slice(2)}`;
}
