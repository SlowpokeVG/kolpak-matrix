import { useEffect, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { useMatrixClient } from '$hooks/useMatrixClient';
import { useRoomNavigate } from '$hooks/useRoomNavigate';
import { getHomeRoomPath } from '$pages/pathUtils';
import { HOME_PATH, ROOT_PATH } from '$pages/paths';
import { getCanonicalAliasOrRoomId } from '$utils/matrix';
import { resolveMainRoom } from './mainRoom';
import { getSimpleMode, partOn } from './simpleMode';

// Shlomo mode, "Open the main room on start": the chat people use every day is the first
// thing on screen. Once per start, and only when the app opened on the plain home list: a
// notification, a link or a reload inside a room keeps its own target. With "All chats in
// one list" it opens under Home, where that list is, so back leads to it; without, where
// the room lives (its space, or the direct chats).
//
// The effect depends on the client only: it used to depend on useRoomNavigate's function,
// which changes as the first sync fills in spaces and direct chats; the change cancelled the
// wait and the once-per-start flag kept it from starting again, so nothing opened. The
// navigation functions are read through refs.

const WAIT_MS = 30_000;
const POLL_MS = 500;

let opened = false;

export function SimpleMainRoom() {
  const mx = useMatrixClient();
  const navigate = useNavigate();
  const navigateRef = useRef(navigate);
  navigateRef.current = navigate;
  const { navigateRoom } = useRoomNavigate();
  const navigateRoomRef = useRef(navigateRoom);
  navigateRoomRef.current = navigateRoom;
  const { pathname } = useLocation();
  const startPath = useRef(pathname);

  useEffect(() => {
    if (opened) return undefined;
    const mode = getSimpleMode();
    if (!partOn(mode, 'openMainRoom')) return undefined;
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
        if (partOn(getSimpleMode(), 'oneList')) {
          navigateRef.current(getHomeRoomPath(getCanonicalAliasOrRoomId(mx, roomId)));
        } else {
          navigateRoomRef.current(roomId);
        }
      } else if (Date.now() - started > WAIT_MS) {
        window.clearInterval(timer);
        opened = true;
      }
    }, POLL_MS);
    return () => window.clearInterval(timer);
  }, [mx]);

  return null;
}
