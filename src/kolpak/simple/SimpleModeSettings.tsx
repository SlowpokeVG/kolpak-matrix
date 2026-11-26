import { useMemo } from 'react';
import { Box, Text } from 'folds';
import { SequenceCard, SequenceCardStyle } from '$components/sequence-card';
import { SettingTile, SettingToggle } from '$components/setting-tile';
import { useMatrixClient } from '$hooks/useMatrixClient';
import { useSetting } from '$state/hooks/settings';
import { MessageLayout, settingsAtom } from '$state/settings';
import { chatRooms } from './mainRoom';
import { updateSimpleMode, useSimpleMode } from './simpleMode';
import '../voice/voice-settings.css';

// Settings → General, first card: the simple-mode switch and the main room.
//
// Turning it on also sets four of Sable's own settings the way a messenger looks (bubbles,
// yours on the right, no join/leave or name-change lines) and remembers how they were, so
// turning it off puts them back. They stay changeable in Appearance while it is on.

export function SimpleModeSettings() {
  const mx = useMatrixClient();
  const simple = useSimpleMode();
  const [messageLayout, setMessageLayout] = useSetting(settingsAtom, 'messageLayout');
  const [useRightBubbles, setUseRightBubbles] = useSetting(settingsAtom, 'useRightBubbles');
  const [hideMembershipEvents, setHideMembershipEvents] = useSetting(
    settingsAtom,
    'hideMembershipEvents'
  );
  const [hideNickAvatarEvents, setHideNickAvatarEvents] = useSetting(
    settingsAtom,
    'hideNickAvatarEvents'
  );

  const rooms = useMemo(
    () =>
      chatRooms(mx)
        .map((room) => ({ id: room.roomId, name: room.name, members: room.getJoinedMemberCount() }))
        .toSorted((a, b) => a.name.localeCompare(b.name)),
    // The list only has to be right when the page opens.
    [mx]
  );

  const toggle = (enabled: boolean) => {
    if (enabled) {
      updateSimpleMode({
        enabled: true,
        before: { messageLayout, useRightBubbles, hideMembershipEvents, hideNickAvatarEvents },
      });
      setMessageLayout(MessageLayout.Bubble);
      setUseRightBubbles(true);
      setHideMembershipEvents(true);
      setHideNickAvatarEvents(true);
      return;
    }
    const { before } = simple;
    updateSimpleMode({ enabled: false, before: undefined });
    if (before) {
      setMessageLayout(before.messageLayout);
      setUseRightBubbles(before.useRightBubbles);
      setHideMembershipEvents(before.hideMembershipEvents);
      setHideNickAvatarEvents(before.hideNickAvatarEvents);
    }
  };

  return (
    <Box direction="Column" gap="100">
      <Text size="L400">Kolpak</Text>
      <SequenceCard className={SequenceCardStyle} variant="SurfaceVariant" direction="Column">
        <SettingToggle
          title="Simple mode"
          focusId="kolpak-simple-mode"
          description="Everyday layout: a messenger-style room list with the last message, chat bubbles in a plain font, only the settings you need, and your main room opens when Kolpak starts."
          value={simple.enabled}
          onChange={toggle}
          ariaLabel="kolpak-simple-mode"
        />
        {simple.enabled && (
          <SettingTile
            title="Main room"
            focusId="kolpak-main-room"
            description="Opens when Kolpak starts."
            after={
              <select
                className="kolpak-select"
                aria-label="Main room"
                value={simple.mainRoomId}
                onChange={(event) => updateSimpleMode({ mainRoomId: event.target.value })}
              >
                <option value="">The busiest room</option>
                {rooms.map((room) => (
                  <option key={room.id} value={room.id}>
                    {room.name} ({room.members})
                  </option>
                ))}
              </select>
            }
          />
        )}
      </SequenceCard>
    </Box>
  );
}
