import { matchPath, useLocation, useNavigate } from 'react-router';
import { Box, color, Text } from 'folds';
import {
  SidebarAvatar,
  SidebarItem,
  SidebarItemTooltip,
  SidebarUnreadBadge,
} from '$components/sidebar';
import { GearSix, getPhosphorIconSize } from '$components/icons/phosphor';
import {
  useInboxSelected,
  useNavigateSelected,
  useProfileSelected,
} from '$hooks/router/useRouteSelected';
import { useInboxNotificationCount } from '$hooks/useInboxNotificationCount';
import { useInviteCount } from '$hooks/useInviteCount';
import { useMobileTapActivation } from '$hooks/useMobileTapActivation';
import { getProfilePath } from '$pages/pathUtils';
import { SETTINGS_PATH } from '$pages/paths';

// Shlomo mode, "Two tabs at the bottom": the second tab of a phone's bar. It opens the
// account page (Profile.tsx), which then also holds the inbox and search, and stays lit on
// all of them; it carries the inbox's count, since the inbox has no tab of its own.

export function ShlomoSettingsTab() {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const profileSelected = useProfileSelected();
  const inboxSelected = useInboxSelected();
  const navigateSelected = useNavigateSelected();
  const opened =
    profileSelected || inboxSelected || navigateSelected || !!matchPath(SETTINGS_PATH, pathname);
  const badge = useInviteCount() + useInboxNotificationCount();

  const open = () => navigate(getProfilePath());
  const mobileTapActivation = useMobileTapActivation(true, open, open);

  return (
    <SidebarItem isBottom>
      <SidebarItemTooltip tooltip="Settings" position="Top">
        {(triggerRef) => (
          <Box direction="Column" alignItems="Center">
            <SidebarAvatar as="button" ref={triggerRef} {...mobileTapActivation} size="400">
              <GearSix
                size={getPhosphorIconSize('inline')}
                weight={opened ? 'fill' : 'regular'}
                color={opened ? color.Primary.Main : color.Background.OnContainer}
              />
            </SidebarAvatar>
            <Text size="B300" priority="300">
              Settings
            </Text>
          </Box>
        )}
      </SidebarItemTooltip>
      {badge > 0 && <SidebarUnreadBadge highlight count={badge} />}
    </SidebarItem>
  );
}
