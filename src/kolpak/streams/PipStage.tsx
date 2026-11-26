import { useLayoutEffect, useRef } from 'react';
import { borrowPlayer } from './sharedPlayer';
import { useAndroidPip } from './pip';
import './stream-dock.css';

// Android picture in picture: the app's window is the floating window, so while it is open
// the page is just the video, black around it. The video is borrowed from whichever view
// was playing it and handed back when the window closes or expands.

function Stage() {
  const host = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (!host.current) return undefined;
    return borrowPlayer(host.current);
  }, []);
  return <div ref={host} className="kolpak-pip-stage" />;
}

export function PipStage() {
  const active = useAndroidPip();
  return active ? <Stage /> : null;
}
