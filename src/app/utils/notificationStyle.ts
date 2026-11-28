import { EventType } from 'matrix-js-sdk/lib/@types/event';

export const DEFAULT_NOTIFICATION_ICON = '/public/res/logo-maskable/logo-maskable-180x180.png';
export const DEFAULT_NOTIFICATION_BADGE = '/public/res/logo-maskable/logo-maskable-72x72.png';
const DEFAULT_MESSAGE_PREVIEW = 'new message';
export const ENCRYPTED_MESSAGE_PREVIEW = 'Encrypted message';

type RoomMessageNotificationInput = {
  roomName?: string;
  username?: string;
  roomAvatar?: string;
  previewText?: string;
  silent?: boolean;
  eventId?: string;
  data?: unknown;
  /** Matrix user ID of the account that received the notification. When provided,
   * the account's localpart is appended to the title so multi-account users know
   * which account the notification is for. */
  recipientId?: string;
};

type NotificationPayload = {
  title: string;
  options: NotificationOptions;
};

type NotificationPreviewInput = {
  content?: unknown;
  eventType?: string;
  isEncryptedRoom?: boolean;
  showMessageContent: boolean;
  showEncryptedMessageContent: boolean;
};

const getString = (value: unknown, fallback: string): string => {
  if (typeof value !== 'string') return fallback;
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : fallback;
};

const getBodyFromContent = (content: unknown): string | undefined => {
  if (!content || typeof content !== 'object') return undefined;
  const { body } = content as Record<string, unknown>;
  if (typeof body !== 'string') return undefined;
  const normalized = body.trim();
  return normalized.length > 0 ? normalized : undefined;
};

const record = (value: unknown): Record<string, unknown> | undefined =>
  value && typeof value === 'object' ? (value as Record<string, unknown>) : undefined;

/**
 * Kolpak: media say what they are ("Image", "GIF", "Sticker"…) instead of their body, which
 * for media is usually the file name. A caption (MSC2530: a body next to a different
 * `filename`) follows the kind. Mirrored natively in UnifiedPushNotifier.previewText.
 */
export const mediaPreviewLabel = (content: unknown, eventType?: string): string | undefined => {
  const c = record(content);
  if (eventType === 'm.sticker') return 'Sticker';
  if (!c) return undefined;
  const info = record(c.info);
  const mimetype = typeof info?.mimetype === 'string' ? info.mimetype : '';
  const animated = info?.['fi.mau.gif'] === true || info?.['fi.mau.loop'] === true;
  let kind: string | undefined;
  switch (c.msgtype) {
    case 'm.image':
      kind = mimetype === 'image/gif' || animated ? 'GIF' : 'Image';
      break;
    case 'm.video':
      kind = animated ? 'GIF' : 'Video';
      break;
    case 'm.audio':
      kind = c['org.matrix.msc3245.voice'] !== undefined ? 'Voice message' : 'Audio';
      break;
    case 'm.file':
      kind = 'File';
      break;
    case 'm.location':
      kind = 'Location';
      break;
    default:
      return undefined;
  }
  const body = typeof c.body === 'string' ? c.body.trim() : '';
  const caption =
    typeof c.filename === 'string' && body.length > 0 && body !== c.filename.trim() ? body : '';
  return caption ? `${kind}: ${caption}` : kind;
};

export const resolveNotificationPreviewText = ({
  content,
  eventType,
  isEncryptedRoom,
  showMessageContent,
  showEncryptedMessageContent,
}: NotificationPreviewInput): string => {
  // Handle reactions specially - show the reaction emoji
  if (eventType === 'm.reaction' && content && typeof content === 'object') {
    const relatesTo = (content as Record<string, unknown>)['m.relates_to'];
    if (relatesTo && typeof relatesTo === 'object') {
      const { key } = relatesTo as Record<string, unknown>;
      if (typeof key === 'string') {
        return `Reacted with ${key}`;
      }
    }
    return 'Added a reaction';
  }

  const encryptedContext = isEncryptedRoom || eventType === EventType.RoomMessageEncrypted;

  if (!showMessageContent) {
    return encryptedContext ? ENCRYPTED_MESSAGE_PREVIEW : DEFAULT_MESSAGE_PREVIEW;
  }
  if (encryptedContext && !showEncryptedMessageContent) {
    return ENCRYPTED_MESSAGE_PREVIEW;
  }

  const media = mediaPreviewLabel(content, eventType);
  if (media) return media;

  const body = getBodyFromContent(content);
  if (body) return body;

  return encryptedContext ? ENCRYPTED_MESSAGE_PREVIEW : DEFAULT_MESSAGE_PREVIEW;
};

/** Extracts the localpart (everything between @ and the first :) from a Matrix user ID. */
const toLocalpart = (userId: string): string => userId.match(/^@([^:]+):/)?.[1] ?? userId;

export const buildRoomMessageNotification = ({
  roomName,
  username,
  roomAvatar,
  previewText,
  silent,
  eventId,
  data,
  recipientId,
}: RoomMessageNotificationInput): NotificationPayload => {
  const sender = getString(username, 'Someone');
  const room = getString(roomName, 'Unknown');
  const message = getString(previewText, DEFAULT_MESSAGE_PREVIEW);
  const avatar = getString(roomAvatar, DEFAULT_NOTIFICATION_ICON);
  const recipientSuffix = recipientId ? ` • ${toLocalpart(recipientId)}` : '';

  return {
    title: `${sender} in ${room}${recipientSuffix}`,
    options: {
      icon: avatar,
      badge: avatar || DEFAULT_NOTIFICATION_BADGE,
      body: `${sender}: ${message}`,
      silent,
      tag: eventId ?? `${room}-${sender}`,
      data,
    },
  };
};
