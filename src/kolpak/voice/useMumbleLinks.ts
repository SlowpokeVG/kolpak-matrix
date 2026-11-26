import { useEffect, useRef } from 'react';
import { isMobileTauri } from '$utils/platform';
import { setDockOpen } from '../layout/dockStore';
import { setLiveSheetOpen } from '../mobile/liveSheetStore';
import { mumbleTargetFromHref } from './mumbleLinks';
import { voiceSupported } from './platform';
import { joinMumbleLink } from './voiceStore';

/**
 * Mumble links anywhere in the client (the bot's "join", a `mumble://` link someone pasted)
 * join with Kolpak's own voice instead of opening a browser or another Mumble app.
 *
 * One click listener on the document, in the capture phase, so it runs before the message
 * view's own link handling and before the webview opens the link outside. Ordinary clicks
 * only: a modifier or another button leaves the link to the system.
 *
 * On desktop the dock opens so the channel tree is in view. On a phone the live bar already
 * shows the voice state; the live panel opens only when joining fails, to show why.
 */
export function useMumbleLinks(username: string): void {
  const name = useRef(username);
  name.current = username;

  useEffect(() => {
    if (!voiceSupported()) return undefined;
    const onClick = (event: MouseEvent) => {
      if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
        return;
      }
      const anchor = event.target instanceof Element ? event.target.closest('a[href]') : null;
      if (!anchor) return;
      const target = mumbleTargetFromHref(anchor.getAttribute('href') ?? '');
      if (!target) return;
      event.preventDefault();
      event.stopPropagation();

      const phone = isMobileTauri();
      if (!phone) setDockOpen(true);
      void joinMumbleLink(target, name.current).then((ok) => {
        if (!ok && phone) setLiveSheetOpen(true);
      });
    };
    document.addEventListener('click', onClick, true);
    return () => document.removeEventListener('click', onClick, true);
  }, []);
}
