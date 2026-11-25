import type { MatrixClient, MatrixEvent, Room, RoomMessageEventContent } from '$types/matrix-sdk';
import { MsgType } from '$types/matrix-sdk';
import { getMatrixToUser } from '$plugins/matrix-to';
import { getMxIdLocalPart } from '$utils/matrix';
import { getMemberDisplayName } from '$utils/room/display';
import { sanitizeText } from '$utils/sanitize';

// "дать пососать": a community joke, asked for by the owner. From the menu on someone
// else's message it sends what typing "/me дал пососать <name>" would: an m.emote whose
// name is a real mention (a matrix.to link plus m.mentions), so it shows as a pill and
// pings them, as when the name is picked from the composer's mention list.

export const POSOSAT_LABEL = 'дать пососать';
export const POSOSAT_ACTION = 'дал пососать';

export type EmoteContent = {
  msgtype: MsgType.Emote;
  body: string;
  format: 'org.matrix.custom.html';
  formatted_body: string;
  'm.mentions': { user_ids: string[] };
};

/** The name as the room shows it: the member's display name, else the ID's local part. */
export function mentionName(room: Room, userId: string): string {
  return getMemberDisplayName(room, userId) ?? getMxIdLocalPart(userId) ?? userId;
}

export function pososatContent(userId: string, name: string): EmoteContent {
  return {
    msgtype: MsgType.Emote,
    body: `${POSOSAT_ACTION} ${name}`,
    format: 'org.matrix.custom.html',
    formatted_body: `${POSOSAT_ACTION} <a href="${sanitizeText(encodeURI(getMatrixToUser(userId)))}">${sanitizeText(name)}</a>`,
    'm.mentions': { user_ids: [userId] },
  };
}

/** Whether the menu should offer it: someone else's message, in a room we may post in. */
export function canGivePososat(mx: MatrixClient, room: Room, mEvent: MatrixEvent): boolean {
  const sender = mEvent.getSender();
  return !!sender && sender !== mx.getUserId() && !mEvent.isRedacted() && room.maySendMessage();
}

/**
 * Send it to the sender of `mEvent`, in the same thread when the message is in one.
 * Rejects when the send fails.
 */
export async function givePososat(
  mx: MatrixClient,
  room: Room,
  mEvent: MatrixEvent
): Promise<void> {
  const sender = mEvent.getSender();
  if (!sender) return;
  const content = pososatContent(sender, mentionName(room, sender));
  // The cast is the composer's too: the SDK's content type is narrower than what is sent.
  await mx.sendMessage(
    room.roomId,
    mEvent.threadRootId ?? null,
    content as unknown as RoomMessageEventContent
  );
}
