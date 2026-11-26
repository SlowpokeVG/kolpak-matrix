import type { Room } from '$types/matrix-sdk';
import { useMatrixClient } from '$hooks/useMatrixClient';
import { useRoomLatestRenderedEvent } from '$hooks/useRoomLatestRenderedEvent';
import { useSetting } from '$state/hooks/settings';
import { settingsAtom } from '$state/settings';
import { getMxIdLocalPart } from '$utils/matrix';
import { previewHasSender, previewText, previewTime } from './roomPreview';

// The text of a room row in simple mode (RoomNavItem): the name and the time of the last
// message on the first line, who said what on the second. The unread count stays where
// Sable puts it, to the right.

type SimpleRoomTextProps = {
  room: Room;
  name: string;
  direct?: boolean;
  /** Unread: the name is set bold. */
  strong?: boolean;
};

export function SimpleRoomText({ room, name, direct, strong }: SimpleRoomTextProps) {
  const mx = useMatrixClient();
  const latest = useRoomLatestRenderedEvent(room);
  const [hour24] = useSetting(settingsAtom, 'hour24Clock');

  let line: string | undefined;
  if (latest) {
    const text = previewText(latest);
    if (text) {
      const sender = latest.getSender() ?? '';
      let who = '';
      if (previewHasSender(latest)) {
        if (sender === mx.getUserId()) who = 'You';
        else if (!direct) who = room.getMember(sender)?.name ?? getMxIdLocalPart(sender) ?? '';
      }
      line = who ? `${who}: ${text}` : text;
    }
  }

  return (
    <span className="kolpak-simple-row" data-strong={strong ? 'true' : undefined}>
      <span className="kolpak-simple-row__top">
        <span className="kolpak-simple-row__name">{name}</span>
        {latest && (
          <span className="kolpak-simple-row__time">
            {previewTime(latest.getTs(), Date.now(), hour24)}
          </span>
        )}
      </span>
      <span className="kolpak-simple-row__line">{line ?? ' '}</span>
    </span>
  );
}
