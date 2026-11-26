import { useLayoutEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { borrowPlayer } from './sharedPlayer';
import { useAndroidPipStage } from './pip';
import './stream-dock.css';

// Android picture in picture: the app's window is the floating window, so while it is open
// the page is just the video, black around it. Rendered straight into <body>, so nothing in
// the client's layout can clip or cover it. The video is borrowed from whichever view was
// playing it and handed back when the window closes or expands.

function Stage() {
  const host = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (!host.current) return undefined;
    return borrowPlayer(host.current);
  }, []);
  return <div ref={host} className="kolpak-pip-stage" />;
}

export function PipStage() {
  const stage = useAndroidPipStage();
  return stage ? createPortal(<Stage />, document.body) : null;
}
