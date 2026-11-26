import { useEffect, useMemo, useState } from 'react';
import { useClientConfig } from '$hooks/useClientConfig';
import { useDismissOnBack } from '$utils/androidBack';
import { StreamDock } from '../streams/StreamDock';
import { useTheater } from '../theater/theaterStore';
import { useStreamChannels } from '../streams/useStreamChannels';
import { TalkButton } from '../voice/TalkButton';
import { currentChannelSummary } from '../voice/types';
import { VoiceButtons } from '../voice/VoiceButtons';
import { VoiceDock } from '../voice/VoiceDock';
import { voiceSupported } from '../voice/platform';
import { useVoiceRuntime } from '../voice/useVoiceRuntime';
import { useVoiceSettings } from '../voice/useVoiceSettings';
import { connectVoice, useVoice } from '../voice/voiceStore';
import '../streams/stream-dock.css';
import '../voice/voice-dock.css';
import { setLiveSheetOpen, useLiveSheetOpen } from './liveSheetStore';
import './mobile-live.css';

// The live dock on a phone (AI/HANDOFF.md, "Android"). The desktop has a status bar along
// the bottom and the dock on the right; a phone has room for neither, so:
//
// - a 40px bar along the bottom of the client: who is on air, and the voice channel with the
//   mic and deafen squares and, in push-to-talk mode, a TALK button to hold. It hides while
//   the keyboard is up (something editable has focus), so it never sits on the composer.
// - tapping the bar opens the live panel over the client: the stream player (WATCH opens
//   theater, which on a phone is the picture over the chat), the voice tree with join and
//   leave, and a big TALK button. Back or the close button puts it away.

const isEditable = (element: Element | null): boolean =>
  element instanceof HTMLElement &&
  (element.isContentEditable ||
    element instanceof HTMLTextAreaElement ||
    (element instanceof HTMLInputElement &&
      !['button', 'checkbox', 'radio', 'range', 'submit', 'file'].includes(element.type)));

/** Whether the user is typing, which on a phone means the keyboard is up. */
function useTyping(): boolean {
  const [typing, setTyping] = useState(() => isEditable(document.activeElement));
  useEffect(() => {
    const update = () => setTyping(isEditable(document.activeElement));
    // focusout fires before the next element takes focus; look once things settle.
    const later = () => window.setTimeout(update, 0);
    document.addEventListener('focusin', update);
    document.addEventListener('focusout', later);
    return () => {
      document.removeEventListener('focusin', update);
      document.removeEventListener('focusout', later);
    };
  }, []);
  return typing;
}

// "Join voice on startup" runs once per app start.
let autoConnectDone = false;

/**
 * `hidden`: mounted but not drawn (full-page settings), so the voice runtime keeps applying
 * setting changes at once.
 */
export function MobileLiveBar({ hidden = false }: { hidden?: boolean }) {
  const { streamStatsUrl } = useClientConfig();
  const channels = useStreamChannels(streamStatsUrl);
  const voice = useVoice();
  const settings = useVoiceSettings();
  const typing = useTyping();
  const hasVoice = voiceSupported();

  // The bar is always mounted on a phone, which makes it the home of the voice runtime there
  // (the status bar is on desktop).
  useVoiceRuntime();

  useEffect(() => {
    if (autoConnectDone || !hasVoice) return;
    if (!settings.autoConnect || !settings.host || !settings.username) return;
    autoConnectDone = true;
    void connectVoice({ host: settings.host, port: settings.port, username: settings.username });
  }, [hasVoice, settings.autoConnect, settings.host, settings.port, settings.username]);

  const live = useMemo(() => channels?.filter((channel) => channel.live) ?? [], [channels]);
  const summary = voice.status === 'connected' ? currentChannelSummary(voice.snapshot) : undefined;

  if (typing || hidden) return null;
  if (!streamStatsUrl && !hasVoice) return null;

  let voiceLabel = 'voice --';
  if (summary) voiceLabel = `${summary.channel} ${summary.users}`;
  else if (voice.status === 'connecting') voiceLabel = 'voice ...';
  else if (voice.status === 'connected') voiceLabel = 'voice';

  const first = live[0];

  return (
    <footer className="kolpak-mobile-bar" aria-label="Live">
      <button
        type="button"
        className="kolpak-mobile-bar__open"
        onClick={() => setLiveSheetOpen(true)}
        aria-label="open the live panel"
      >
        {streamStatsUrl && (
          <span className="kolpak-mobile-bar__streams" data-idle={first ? undefined : 'true'}>
            {first ? (
              <>
                <span className="kolpak-onair__dot kolpak-round" aria-hidden="true" />
                {first.name}
                <span className="kolpak-mobile-bar__count">{first.viewers}</span>
                {live.length > 1 && (
                  <span className="kolpak-mobile-bar__count">+{live.length - 1}</span>
                )}
              </>
            ) : (
              'off air'
            )}
          </span>
        )}
        {hasVoice && (
          <span className="kolpak-mobile-bar__voice" data-idle={summary ? undefined : 'true'}>
            {voiceLabel}
            {summary && voice.pingMs !== undefined && (
              <span className="kolpak-mobile-bar__count">{Math.round(voice.pingMs)}ms</span>
            )}
          </span>
        )}
      </button>
      {hasVoice && voice.status === 'connected' && (
        <span className="kolpak-mobile-bar__controls">
          <TalkButton variant="bar" />
          <VoiceButtons size="small" />
        </span>
      )}
    </footer>
  );
}

const closeSheet = () => setLiveSheetOpen(false);

export function LiveSheet() {
  const open = useLiveSheetOpen();
  // Theater covers the panel; the panel steps aside so the player has one host, and comes
  // back when theater closes.
  const theater = useTheater().open;
  const { streamStatsUrl } = useClientConfig();
  const hasVoice = voiceSupported();
  useDismissOnBack(closeSheet, open && !theater);

  if (!open || theater) return null;

  return (
    <div className="kolpak-live-sheet" role="dialog" aria-label="Live">
      <header className="kolpak-live-sheet__head">
        <span className="kolpak-live-sheet__title">Live</span>
        <button
          type="button"
          className="kolpak-live-sheet__close"
          onClick={closeSheet}
          aria-label="close the live panel"
        >
          <svg viewBox="0 0 20 20" width="20" height="20" aria-hidden="true">
            <path d="M4 4l12 12M16 4L4 16" />
          </svg>
        </button>
      </header>
      <div className="kolpak-live-sheet__body">
        {streamStatsUrl && <StreamDock />}
        {streamStatsUrl && hasVoice && <div className="kolpak-dock__rule" aria-hidden="true" />}
        {hasVoice && <VoiceDock />}
      </div>
      {hasVoice && (
        <div className="kolpak-live-sheet__talk">
          <TalkButton variant="big" />
        </div>
      )}
    </div>
  );
}
