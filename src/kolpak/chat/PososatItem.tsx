import { useState } from 'react';
import { MenuItem, Text } from 'folds';
import type { MatrixEvent, Room } from '$types/matrix-sdk';
import { useMatrixClient } from '$hooks/useMatrixClient';
import * as css from '$features/room/message/styles.css';
import { canGivePososat, givePososat, POSOSAT_LABEL } from './givePososat';

// The "дать пососать" item in the menu on a message (Sable's message options menu, both
// the desktop pop-out and the mobile sheet). Hidden on our own messages and where we
// cannot post. The menu closes once the emote is on its way; a failed send keeps it open
// and says so.

export function PososatItem({
  room,
  mEvent,
  onClose,
}: {
  room: Room;
  mEvent: MatrixEvent;
  onClose: () => void;
}) {
  const mx = useMatrixClient();
  const [state, setState] = useState<'idle' | 'sending' | 'failed'>('idle');
  if (!canGivePososat(mx, room, mEvent)) return null;

  const give = () => {
    setState('sending');
    givePososat(mx, room, mEvent)
      .then(onClose)
      .catch(() => setState('failed'));
  };

  return (
    <MenuItem
      size="300"
      radii="300"
      className="kolpak-menu-pososat"
      disabled={state === 'sending'}
      onClick={give}
    >
      <Text className={css.MessageMenuItemText} as="span" size="T300" truncate>
        {state === 'failed' ? 'не отправилось. ещё раз?' : POSOSAT_LABEL}
      </Text>
    </MenuItem>
  );
}
