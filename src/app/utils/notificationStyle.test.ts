import { describe, expect, it } from 'vitest';
import { mediaPreviewLabel, resolveNotificationPreviewText } from './notificationStyle';

const preview = (content: unknown, eventType = 'm.room.message') =>
  resolveNotificationPreviewText({
    content,
    eventType,
    isEncryptedRoom: true,
    showMessageContent: true,
    showEncryptedMessageContent: true,
  });

describe('notification preview of media', () => {
  it('names the kind of media instead of the file name', () => {
    expect(preview({ msgtype: 'm.image', body: 'IMG_2041.jpg' })).toBe('Image');
    expect(preview({ msgtype: 'm.file', body: 'report.pdf' })).toBe('File');
    expect(preview({ msgtype: 'm.video', body: 'clip.mp4' })).toBe('Video');
    expect(preview({ msgtype: 'm.audio', body: 'a.ogg' })).toBe('Audio');
    expect(preview({ msgtype: 'm.audio', body: 'a.ogg', 'org.matrix.msc3245.voice': {} })).toBe(
      'Voice message'
    );
    expect(preview({ body: 'cat.png', url: 'mxc://x/y' }, 'm.sticker')).toBe('Sticker');
    expect(preview({ msgtype: 'm.location', body: 'geo:1,2' })).toBe('Location');
  });

  it('tells GIFs apart', () => {
    expect(preview({ msgtype: 'm.image', body: 'a.gif', info: { mimetype: 'image/gif' } })).toBe(
      'GIF'
    );
    expect(preview({ msgtype: 'm.video', body: 'a.mp4', info: { 'fi.mau.gif': true } })).toBe(
      'GIF'
    );
  });

  it('keeps a caption after the kind', () => {
    expect(preview({ msgtype: 'm.image', body: 'look at this', filename: 'IMG_1.jpg' })).toBe(
      'Image: look at this'
    );
    expect(preview({ msgtype: 'm.image', body: 'IMG_1.jpg', filename: 'IMG_1.jpg' })).toBe('Image');
  });

  it('leaves text and reactions as they were', () => {
    expect(preview({ msgtype: 'm.text', body: 'hello' })).toBe('hello');
    expect(mediaPreviewLabel({ msgtype: 'm.notice', body: 'bot' })).toBeUndefined();
    expect(preview({ 'm.relates_to': { key: '👍' } }, 'm.reaction')).toBe('Reacted with 👍');
  });
});
