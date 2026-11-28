import type { ReactNode } from 'react';
import { useMatch } from 'react-router';
import { ScreenSize, useScreenSizeContext } from '$hooks/useScreenSize';
import {
  BUG_REPORT_PATH,
  CREATE_PATH,
  CREATE_ROOM_PATH,
  DIRECT_PATH,
  EXPLORE_PATH,
  HOME_PATH,
  INBOX_PATH,
  NAVIGATE_PATH,
  PROFILE_PATH,
  SPACE_PATH,
} from './paths';

type MobileFriendlyClientNavProps = {
  children: ReactNode;
};
export function MobileFriendlySidebarNav({ children }: MobileFriendlyClientNavProps) {
  const screenSize = useScreenSizeContext();
  const homeMatch = useMatch({ path: HOME_PATH, caseSensitive: true, end: true });
  const directMatch = useMatch({ path: DIRECT_PATH, caseSensitive: true, end: true });
  const spaceMatch = useMatch({ path: SPACE_PATH, caseSensitive: true, end: true });
  const exploreMatch = useMatch({ path: EXPLORE_PATH, caseSensitive: true, end: true });
  const inboxMatch = useMatch({ path: INBOX_PATH, caseSensitive: true, end: true });
  const profileMatch = useMatch({ path: PROFILE_PATH, caseSensitive: true, end: true });
  const navigateMatch = useMatch({ path: NAVIGATE_PATH, caseSensitive: true, end: true });
  if (
    screenSize === ScreenSize.Mobile &&
    (!(homeMatch || directMatch || spaceMatch || exploreMatch) ||
      profileMatch ||
      inboxMatch ||
      navigateMatch)
  ) {
    return null;
  }

  return children;
}

export function MobileFriendlyBottomNav({ children }: MobileFriendlyClientNavProps) {
  const screenSize = useScreenSizeContext();
  const homeMatch = useMatch({ path: HOME_PATH, caseSensitive: true, end: true });
  const directMatch = useMatch({ path: DIRECT_PATH, caseSensitive: true, end: true });
  const spaceMatch = useMatch({ path: SPACE_PATH, caseSensitive: true, end: true });
  const inboxMatch = useMatch({ path: INBOX_PATH, caseSensitive: true, end: false });
  const navigateMatch = useMatch({ path: NAVIGATE_PATH, caseSensitive: true, end: false });
  const profileMatch = useMatch({ path: PROFILE_PATH, caseSensitive: true, end: false });
  const settingsMatch = useMatch({ path: '/settings/', caseSensitive: true, end: true });
  // Kolpak: these one-segment pages match the space pattern too.
  const exploreMatch = useMatch({ path: EXPLORE_PATH, caseSensitive: true, end: false });
  const createMatch = useMatch({ path: CREATE_PATH, caseSensitive: true, end: false });
  const createRoomMatch = useMatch({ path: CREATE_ROOM_PATH, caseSensitive: true, end: false });
  const bugReportMatch = useMatch({ path: BUG_REPORT_PATH, caseSensitive: true, end: false });
  const notASpace = exploreMatch || createMatch || createRoomMatch || bugReportMatch;
  // Kolpak: on every tab's own page, the room lists included (they used to carry the bar
  // inside the list panel, PageRoot's bottomNav, which put it in another place).
  const onBarDestination =
    homeMatch || directMatch || spaceMatch || inboxMatch || navigateMatch || profileMatch;
  if (screenSize !== ScreenSize.Mobile || !onBarDestination || settingsMatch || notASpace) {
    return null;
  }

  return children;
}
