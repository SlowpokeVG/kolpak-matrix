import { useEffect, useRef } from 'react';
import { useLocation } from 'react-router';
import { useMatrixClient } from '$hooks/useMatrixClient';
import { useRoomNavigate } from '$hooks/useRoomNavigate';
import { HOME_PATH, ROOT_PATH } from '$pages/paths';
import { resolveMainRoom } from './mainRoom';
import { getSimpleMode } from './simpleMode';

// Simple mode: open the main room when the app starts, so the chat people use every day is
// the first thing on screen. Once per start, and only when the app opened on the plain home
// list: a notification, a link or a reload inside a room keeps its own target.

const WAIT_MS = 30_000;
const POLL_MS = 500;

let opened = false;

export function SimpleMainRoom() {
  const mx = useMatrixClient();
  const { navigateRoom } = useRoomNavigate();
  const { pathname } = useLocation();
  const startPath = useRef(pathname);

  useEffect(() => {
    if (opened) return undefined;
    opened = true;
    const mode = getSimpleMode();
    if (!mode.enabled) return undefined;
    if (startPath.current !== HOME_PATH && startPath.current !== ROOT_PATH) return undefined;

    // Rooms arrive with the first sync; wait for them a little.
    const started = Date.now();
    const timer = window.setInterval(() => {
      const roomId = resolveMainRoom(mx, mode.mainRoomId);
      if (roomId) {
        window.clearInterval(timer);
        // Pushed, not replaced: on a phone, back then leads to the room list.
        navigateRoom(roomId);
      } else if (Date.now() - started > WAIT_MS) {
        window.clearInterval(timer);
      }
    }, POLL_MS);
    return () => window.clearInterval(timer);
  }, [mx, navigateRoom]);

  return null;
}
