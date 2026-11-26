import { describe, expect, it } from 'vitest';
import type { MatrixEvent } from '$types/matrix-sdk';
import { previewHasSender, previewText, previewTime } from './roomPreview';

const event = (type: string, content: Record<string, unknown>, redacted = false) =>
  ({
    getType: () => type,
    getContent: () => content,
    isRedacted: () => redacted,
  }) as unknown as MatrixEvent;

describe('previewText', () => {
  it('shows text without the reply fallback, on one line', () => {
    expect(
      previewText(event('m.room.message', { msgtype: 'm.text', body: '> <@a:x> hi\n\nwell\nthen' }))
    ).toBe('well then');
  });

  it('names media, files, stickers and what did not decrypt', () => {
    expect(previewText(event('m.room.message', { msgtype: 'm.image', body: 'x.png' }))).toBe(
      'Photo'
    );
    expect(previewText(event('m.room.message', { msgtype: 'm.file', body: 'a.zip' }))).toBe(
      'File: a.zip'
    );
    expect(previewText(event('m.sticker', {}))).toBe('Sticker');
    expect(previewText(event('m.room.encrypted', {}))).toBe('Encrypted message');
    expect(previewText(event('m.room.message', {}, true))).toBe('Message deleted');
  });

  it('puts the sender before messages but not before emotes or room changes', () => {
    expect(previewHasSender(event('m.room.message', { msgtype: 'm.text' }))).toBe(true);
    expect(previewHasSender(event('m.room.message', { msgtype: 'm.emote' }))).toBe(false);
    expect(previewHasSender(event('m.room.name', {}))).toBe(false);
  });
});

describe('previewTime', () => {
  const now = new Date(2026, 10, 26, 15, 0).getTime();

  it('shows the time today, the date long ago', () => {
    expect(previewTime(new Date(2026, 10, 26, 9, 5).getTime(), now)).toBe('09:05');
    expect(previewTime(new Date(2026, 0, 3, 9, 5).getTime(), now)).toBe('03.01');
    expect(previewTime(new Date(2025, 0, 3, 9, 5).getTime(), now)).toBe('03.01.25');
  });
});
