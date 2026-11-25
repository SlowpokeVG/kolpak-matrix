import { useSetting } from '$state/hooks/settings';
import { settingsAtom } from '$state/settings';
import { getNavigatePath } from '$pages/pathUtils';
import { useOpenShallowRoute } from '$pages/client/useShallowRoute';
import { formatShortcut, getShortcutBinding } from '$app/keyboard/shortcuts';
import './room-list.css';

// The "jump to" box at the top of the room list (AI/DESIGN.md §3.2).
// It opens Sable's existing room search, the same one the keyboard shortcut opens.
export function JumpTo() {
  const openShallowRoute = useOpenShallowRoute();
  const [shortcutOverrides] = useSetting(settingsAtom, 'shortcutOverrides');
  const shortcut = formatShortcut(
    getShortcutBinding('navigation.openRoomSearch', shortcutOverrides)
  );

  return (
    <button
      type="button"
      className="kolpak-jump-to"
      onClick={() => openShallowRoute(getNavigatePath())}
    >
      <span>jump to</span>
      <span className="kolpak-jump-to__key" aria-hidden="true">
        {shortcut}
      </span>
    </button>
  );
}
