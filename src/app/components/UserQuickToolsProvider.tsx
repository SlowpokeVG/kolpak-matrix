import { ScreenSize, useScreenSizeContext } from '$hooks/useScreenSize';
import { UserQuickTools } from '$pages/client/sidebar/UserQuickTools';
import { useShlomoMenu } from '../../kolpak/simple/ShlomoMenuRows';

export function UserQuickToolsProvider() {
  const screenSize = useScreenSizeContext();
  const compact = screenSize === ScreenSize.Mobile;
  // Kolpak: Shlomo mode can drop the phone's tab bar; the room lists' ⋮ menu holds its places.
  const noTabs = useShlomoMenu();
  if (!compact || noTabs) return null;
  return <UserQuickTools compact />;
}
