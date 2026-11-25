import { useClientConfig } from '$hooks/useClientConfig';
import { isDesktopTauri } from '$utils/platform';
import { StreamDock } from '../streams/StreamDock';
import { VoiceDock } from '../voice/VoiceDock';
import { useDockOpen } from './dockStore';

// The live dock on the right of the client (AI/DESIGN.md §3.4): the stream on top, a 2px
// rule, the voice tree below. Desktop app only: voice needs the native Mumble bridge.
export function ClientDock() {
  const open = useDockOpen();
  const { streamStatsUrl } = useClientConfig();
  if (!open || !isDesktopTauri()) return null;
  return (
    <aside className="kolpak-dock" aria-label="Live">
      {streamStatsUrl && (
        <>
          <StreamDock />
          <div className="kolpak-dock__rule" aria-hidden="true" />
        </>
      )}
      <VoiceDock />
    </aside>
  );
}
