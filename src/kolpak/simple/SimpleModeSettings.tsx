import { useMemo } from 'react';
import { Box, Text } from 'folds';
import { SequenceCard, SequenceCardStyle } from '$components/sequence-card';
import { SettingTile, SettingToggle } from '$components/setting-tile';
import { useMatrixClient } from '$hooks/useMatrixClient';
import { chatRooms } from './mainRoom';
import { SHLOMO_PARTS, setShlomoPart, updateSimpleMode, useSimpleMode } from './simpleMode';
import '../voice/voice-settings.css';

// Settings → General, first card: Shlomo mode, its master switch, a switch per part and the
// main room. The look's Sable settings follow in ShlomoLookSync.

export function SimpleModeSettings() {
  const mx = useMatrixClient();
  const simple = useSimpleMode();

  const rooms = useMemo(
    () =>
      chatRooms(mx)
        .map((room) => ({ id: room.roomId, name: room.name, members: room.getJoinedMemberCount() }))
        .toSorted((a, b) => a.name.localeCompare(b.name)),
    // The list only has to be right when the page opens.
    [mx]
  );

  return (
    <Box direction="Column" gap="100">
      <Text size="L400">Kolpak</Text>
      <SequenceCard className={SequenceCardStyle} variant="SurfaceVariant" direction="Column">
        <SettingToggle
          title="Shlomo mode"
          focusId="kolpak-simple-mode"
          description="The everyday layout, like a messenger. Each part below can be switched on its own."
          value={simple.enabled}
          onChange={(enabled) => updateSimpleMode({ enabled })}
          ariaLabel="kolpak-simple-mode"
        />
      </SequenceCard>
      {simple.enabled && (
        <SequenceCard className={SequenceCardStyle} variant="SurfaceVariant" direction="Column">
          {SHLOMO_PARTS.map((part) => (
            <SettingToggle
              key={part.id}
              title={part.title}
              focusId={`kolpak-shlomo-${part.id}`}
              description={part.description}
              value={simple.parts[part.id]}
              onChange={(on) => setShlomoPart(part.id, on)}
              ariaLabel={`kolpak-shlomo-${part.id}`}
            />
          ))}
          {simple.parts.openMainRoom && (
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
      )}
    </Box>
  );
}
