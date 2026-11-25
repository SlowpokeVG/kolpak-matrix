import type { ReactNode } from 'react';
import { Box } from 'folds';
import { matchPath, useLocation } from 'react-router';
import { ScreenSize, useScreenSizeContext } from '$hooks/useScreenSize';
import { SETTINGS_PATH } from '../paths';
import { isShallowRoute } from './shallowRoute';
import { ClientStatusBar } from '../../../kolpak/layout/ClientStatusBar';

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

  return (
    // Kolpak: the status bar runs under everything on desktop (AI/DESIGN.md §3.5).
    <Box grow="Yes" direction="Column" style={{ minHeight: 0 }}>
      <Box grow="Yes" direction="Row" style={{ minHeight: 0 }}>
        {!fullPageSettings && !railInDrawer && <Box shrink="No">{nav}</Box>}
        <Box grow="Yes" style={{ minWidth: 0 }}>
          {children}
        </Box>
      </Box>
      {!railInDrawer && <ClientStatusBar />}
    </Box>
  );
}
