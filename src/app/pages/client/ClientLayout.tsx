import type { ReactNode } from 'react';
import { Box } from 'folds';
import { matchPath, useLocation } from 'react-router';
import { ScreenSize, useScreenSizeContext } from '$hooks/useScreenSize';
import { SETTINGS_PATH } from '../paths';
import { isShallowRoute } from './shallowRoute';
import { ClientDock } from '../../../kolpak/layout/ClientDock';
import { Theater } from '../../../kolpak/theater/Theater';
import { useTheater } from '../../../kolpak/theater/theaterStore';
import { ClientStatusBar } from '../../../kolpak/layout/ClientStatusBar';
import { LiveSheet, MobileLiveBar } from '../../../kolpak/mobile/MobileLive';
import { isMobileTauri } from '$utils/platform';

type ClientLayoutProps = {
  nav: ReactNode;
  children: ReactNode;
};
export function ClientLayout({ nav, children }: ClientLayoutProps) {
  const location = useLocation();
  const screenSize = useScreenSizeContext();
  const fullPageSettings =
    Boolean(matchPath(SETTINGS_PATH, location.pathname)) &&
    !isShallowRoute(location.pathname, location.state, screenSize);

  const railInDrawer = screenSize === ScreenSize.Mobile;
  // Kolpak: theater mode replaces the routes and the dock on desktop (AI/DESIGN.md §4). The
  // routes stay mounted, only hidden, so the room is where it was on the way back.
  const theaterOpen = useTheater().open && !fullPageSettings;
  const theater = theaterOpen && !railInDrawer;
  // Kolpak: on a phone the dock becomes a bar along the bottom and a panel over the client,
  // and theater covers the client with the picture over the chat (src/kolpak/mobile).
  const mobileLive = railInDrawer && isMobileTauri();

  return (
    // Kolpak: the status bar runs under everything on desktop (AI/DESIGN.md §3.5).
    <Box
      grow="Yes"
      direction="Column"
      style={{ minHeight: 0, position: mobileLive ? 'relative' : undefined }}
    >
      <Box grow="Yes" direction="Row" style={{ minHeight: 0 }}>
        {!fullPageSettings && !railInDrawer && <Box shrink="No">{nav}</Box>}
        <Box grow="Yes" style={{ minWidth: 0, display: theater ? 'none' : undefined }}>
          {children}
        </Box>
        {theater && <Theater />}
        {!railInDrawer && !theater && <ClientDock />}
      </Box>
      {!railInDrawer && <ClientStatusBar />}
      {mobileLive && <MobileLiveBar hidden={fullPageSettings} />}
      {mobileLive && <LiveSheet />}
      {mobileLive && theaterOpen && <Theater stacked />}
    </Box>
  );
}
