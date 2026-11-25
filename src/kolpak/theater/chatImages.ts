import type { MatrixClient, RoomMessageEventContent } from '$types/matrix-sdk';
import { encryptFile, uploadContent } from '$utils/matrix';
import { getImageMsgContent } from '$features/room/msgContent';
import type { TUploadItem } from '$state/room/roomInputDrafts';

// Posting an image from the theater chat, the same way Sable's composer does it: encrypt
// it first in an encrypted room, upload it, then send an m.image with size, blurhash and
// (for large images) a thumbnail. Sable's own helpers do each step.

/** Image types the theater chat accepts, by MIME type. */
export const isPostableImage = (file: File): boolean => file.type.startsWith('image/');

const upload = (mx: MatrixClient, file: File): Promise<string> =>
  new Promise((resolve, reject) => {
    void uploadContent(mx, file, {
      onSuccess: resolve,
      onError: reject,
    });
  });

export async function sendImage(mx: MatrixClient, roomId: string, file: File): Promise<void> {
  const room = mx.getRoom(roomId);
  if (!room) throw new Error('not in that room.');
  if (!isPostableImage(file)) throw new Error('only images can be posted here.');

  let item: TUploadItem;
  if (room.hasEncryptionStateEvent()) {
    const encrypted = await encryptFile(file);
    item = {
      file: encrypted.file,
      originalFile: file,
      encInfo: encrypted.encInfo,
      metadata: { markedAsSpoiler: false },
    };
  } else {
    item = { file, originalFile: file, encInfo: undefined, metadata: { markedAsSpoiler: false } };
  }

  const mxc = await upload(mx, item.file);
  const content = await getImageMsgContent(mx, item, mxc);
  await mx.sendMessage(roomId, content as RoomMessageEventContent);
}

/** Image files from a paste or a drop, if there are any. */
export function imagesFrom(data: DataTransfer | null): File[] {
  if (!data) return [];
  return Array.from(data.files).filter(isPostableImage);
}
