import { useNavigate } from 'react-router';
import { Avatar, Badge, Box, color, config, IconButton, Line, MenuItem, Text } from 'folds';
import { ListMagnifyingGlassIcon } from '@phosphor-icons/react';
import { UserAvatar } from '$components/user-avatar';
import { ArrowLeft, composerIcon, GearSix, menuIcon, Tray } from '$components/icons/phosphor';
import { useOpenSettings } from '$features/settings';
import { useInboxNotificationCount } from '$hooks/useInboxNotificationCount';
import { useInviteCount } from '$hooks/useInviteCount';
import { useMatrixClient } from '$hooks/useMatrixClient';
import { useMediaAuthentication } from '$hooks/useMediaAuthentication';
import { ScreenSize, useScreenSizeContext } from '$hooks/useScreenSize';
import { useUserProfile } from '$hooks/useUserProfile';
import { useOpenShallowRoute } from '$pages/client/useShallowRoute';
import { getHomePath, getInboxPath, getNavigatePath, getProfilePath } from '$pages/pathUtils';
import { getMxIdLocalPart, mxcUrlToHttp } from '$utils/matrix';
import { nameInitials } from '$utils/common';
import { useShlomo } from './simpleMode';

// Shlomo mode, "No tab bar" (phone): what the bar at the bottom held, in the ⋮ menu of the
// room lists instead: the inbox with its count, search, the account page (presence, other
// accounts, profile, logout) and the settings. The ⋮ button carries a dot while the inbox
// has something.

/** Whether the room lists' menu stands in for the tab bar. */
export function useShlomoMenu(): boolean {
  const noTabs = useShlomo('noTabs');
  const mobile = useScreenSizeContext() === ScreenSize.Mobile;
  return noTabs && mobile;
}

/** The inbox's count for the ⋮ button's dot; 0 when the menu does not stand in for the bar. */
export function useShlomoMenuBadge(): number {
  const on = useShlomoMenu();
  const count = useInviteCount() + useInboxNotificationCount();
  return on ? count : 0;
}

export function ShlomoMenuRows({ requestClose }: { requestClose: () => void }) {
  const on = useShlomoMenu();
  const mx = useMatrixClient();
  const navigate = useNavigate();
  const openShallowRoute = useOpenShallowRoute();
  const openSettings = useOpenSettings();
  const useAuthentication = useMediaAuthentication();
  const inbox = useInviteCount() + useInboxNotificationCount();
  const userId = mx.getUserId() ?? '';
  const profile = useUserProfile(userId);
  if (!on) return null;

  const displayName = profile.displayName ?? getMxIdLocalPart(userId) ?? userId;
  const avatarUrl = profile.avatarUrl
    ? (mxcUrlToHttp(mx, profile.avatarUrl, useAuthentication, 96, 96, 'crop') ?? undefined)
    : undefined;
  const go = (action: () => void) => () => {
    requestClose();
    action();
  };

  return (
    <>
      <Line variant="Surface" size="300" />
      <Box direction="Column" gap="100" style={{ padding: config.space.S100 }}>
        <MenuItem
          size="300"
          radii="300"
          after={
            inbox > 0 ? (
              <Badge variant="Success" size="400" fill="Solid" radii="Pill">
                <Text as="span" size="L400">
                  {inbox}
                </Text>
              </Badge>
            ) : (
              menuIcon(Tray)
            )
          }
          onClick={go(() => navigate(getInboxPath()))}
        >
          <Text style={{ flexGrow: 1 }} as="span" size="T300" truncate>
            Inbox
          </Text>
        </MenuItem>
        <MenuItem
          size="300"
          radii="300"
          after={menuIcon(ListMagnifyingGlassIcon)}
          onClick={go(() => openShallowRoute(getNavigatePath()))}
        >
          <Text style={{ flexGrow: 1 }} as="span" size="T300" truncate>
            Search rooms and people
          </Text>
        </MenuItem>
      </Box>
      <Line variant="Surface" size="300" />
      <Box direction="Column" gap="100" style={{ padding: config.space.S100 }}>
        <MenuItem
          size="300"
          radii="300"
          after={
            <Avatar size="200" radii="Pill">
              <UserAvatar
                userId={userId}
                src={avatarUrl}
                alt={displayName}
                renderFallback={() => <Text size="H6">{nameInitials(displayName)}</Text>}
              />
            </Avatar>
          }
          onClick={go(() => navigate(getProfilePath()))}
        >
          <Box direction="Column" grow="Yes" style={{ minWidth: 0 }}>
            <Text as="span" size="T300" truncate>
              {displayName}
            </Text>
            <Text as="span" size="T200" priority="300" truncate>
              Account, status, log out
            </Text>
          </Box>
        </MenuItem>
        <MenuItem
          size="300"
          radii="300"
          after={menuIcon(GearSix)}
          onClick={go(() => openSettings())}
        >
          <Text style={{ flexGrow: 1 }} as="span" size="T300" truncate>
            Settings
          </Text>
        </MenuItem>
      </Box>
    </>
  );
}

/** The ⋮ button's dot while the inbox has something. */
export function ShlomoMenuDot({ count }: { count: number }) {
  if (count <= 0) return null;
  return (
    <span
      aria-label={`${count} in the inbox`}
      style={{
        position: 'absolute',
        top: 6,
        right: 6,
        width: 8,
        height: 8,
        borderRadius: '50%',
        background: color.Success.Main,
        pointerEvents: 'none',
      }}
    />
  );
}

/** Back to the room list from the pages the menu opens, when there is no tab bar. */
export function ShlomoBackButton() {
  const on = useShlomoMenu();
  const navigate = useNavigate();
  if (!on) return null;
  return (
    <IconButton aria-label="Back" variant="Background" onClick={() => navigate(getHomePath())}>
      {composerIcon(ArrowLeft)}
    </IconButton>
  );
}
