import { useAtomValue, useSetAtom } from 'jotai';
import type { Room } from '$types/matrix-sdk';
import { UserAvatar } from '$components/user-avatar';
import { useMatrixClient } from '$hooks/useMatrixClient';
import { useMediaAuthentication } from '$hooks/useMediaAuthentication';
import { modalAtom, ModalType } from '$state/modal';
import { nicknamesAtom } from '$state/nicknames';
import { getMxIdLocalPart } from '$utils/matrix';
import { getAvatarUrl, getMemberDisplayName } from '$utils/room/display';
import { useEventReaders } from './receiptStore';
import './receipts.css';

// Under a message: the avatars of the people whose last read message it is, up to three and
// "+N" for the rest. Tapping opens Sable's list of who has read it.

const SHOWN = 3;

export function ReadReceiptAvatars({ room, eventId }: { room: Room; eventId: string | undefined }) {
  const mx = useMatrixClient();
  const useAuthentication = useMediaAuthentication();
  const nicknames = useAtomValue(nicknamesAtom);
  const setModal = useSetAtom(modalAtom);
  const readers = useEventReaders(room, eventId);
  if (!eventId || readers.length === 0) return null;

  const name = (userId: string) =>
    getMemberDisplayName(room, userId, nicknames) ?? getMxIdLocalPart(userId) ?? userId;
  const shown = readers.slice(0, SHOWN);
  const more = readers.length - shown.length;
  const label = `Read by ${readers.map(name).join(', ')}`;

  return (
    <div className="kolpak-receipts">
      <button
        type="button"
        className="kolpak-receipts__button"
        title={label}
        aria-label={label}
        onClick={(event) => {
          event.stopPropagation();
          setModal({ type: ModalType.ReadReceipts, room, eventId });
        }}
      >
        {shown.map((userId) => (
          <span key={userId} className="kolpak-receipts__avatar kolpak-round">
            <UserAvatar
              userId={userId}
              src={getAvatarUrl(
                mx,
                room.getMember(userId)?.getMxcAvatarUrl(),
                32,
                useAuthentication
              )}
              alt={name(userId)}
              renderFallback={() => (
                <span className="kolpak-receipts__initial">{name(userId).slice(0, 1)}</span>
              )}
            />
          </span>
        ))}
        {more > 0 && <span className="kolpak-receipts__more">+{more}</span>}
      </button>
    </div>
  );
}
