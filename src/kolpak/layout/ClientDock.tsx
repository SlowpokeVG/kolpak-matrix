import { isDesktopTauri } from '$utils/platform';
import { VoiceDock } from '../voice/VoiceDock';
import { useDockOpen } from './dockStore';

// The live dock on the right of the client (AI/DESIGN.md §3.4). Voice only for now; the
// stream player goes above it. Desktop app only: voice needs the native Mumble bridge.
export function ClientDock() {
  const open = useDockOpen();
  if (!open || !isDesktopTauri()) return null;
  return <VoiceDock />;
}
