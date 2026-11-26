import { useEffect, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { useMatrixClient } from '$hooks/useMatrixClient';
import { getHomeRoomPath } from '$pages/pathUtils';
import { HOME_PATH, ROOT_PATH } from '$pages/paths';
import { getCanonicalAliasOrRoomId } from '$utils/matrix';
import { resolveMainRoom } from './mainRoom';
import { getSimpleMode } from './simpleMode';

// Simple mode: open the main room when the app starts, so the chat people use every day is
// the first thing on screen. Once per start, and only when the app opened on the plain home
// list: a notification, a link or a reload inside a room keeps its own target. It opens
// under Home, where simple mode lists every chat, so back leads to that list.
//
// The effect depends on the client only: it used to depend on useRoomNavigate's function,
// which changes as the first sync fills in spaces and direct chats; the change cancelled the
// wait and the once-per-start flag kept it from starting again, so nothing opened.

const WAIT_MS = 30_000;
const POLL_MS = 500;

let opened = false;

export function SimpleMainRoom() {
  const mx = useMatrixClient();
  const navigate = useNavigate();
  const navigateRef = useRef(navigate);
  navigateRef.current = navigate;
  const { pathname } = useLocation();
  const startPath = useRef(pathname);

  useEffect(() => {
    if (opened) return undefined;
    const mode = getSimpleMode();
    if (!mode.enabled) return undefined;
    if (startPath.current !== HOME_PATH && startPath.current !== ROOT_PATH) {
      opened = true;
      return undefined;
    }

    // Rooms arrive with the first sync; wait for them a little.
    const started = Date.now();
    const timer = window.setInterval(() => {
      const roomId = resolveMainRoom(mx, mode.mainRoomId);
      if (roomId) {
        window.clearInterval(timer);
        opened = true;
        // Pushed, not replaced: on a phone, back then leads to the room list.
        navigateRef.current(getHomeRoomPath(getCanonicalAliasOrRoomId(mx, roomId)));
      } else if (Date.now() - started > WAIT_MS) {
        window.clearInterval(timer);
        opened = true;
      }
    }, POLL_MS);
    return () => window.clearInterval(timer);
  }, [mx]);

  return null;
}
