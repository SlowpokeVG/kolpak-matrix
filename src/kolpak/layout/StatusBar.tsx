import { useEffect, useState } from 'react';
import './status-bar.css';

// The inverted bar along the bottom of the window (AI/DESIGN.md §3.5):
// clock · stream channels · (right) voice channel · latency.
// With no data it shows the clock and "--" placeholders. The voice entry is a button when
// `onVoiceClick` is given: it joins voice when disconnected and leaves when connected.

export type StatusBarStream = {
  name: string;
  live: boolean;
  viewers?: number;
};

export type StatusBarVoice = {
  channel: string;
  users: number;
  pingMs?: number;
};

export type StatusBarVoiceStatus = 'disconnected' | 'connecting' | 'connected';

type StatusBarProps = {
  streams?: StatusBarStream[];
  voice?: StatusBarVoice;
  voiceStatus?: StatusBarVoiceStatus;
  /** Why voice is not connected, shown beside the placeholder. */
  voiceError?: string;
  /** Tooltip of the voice button; defaults to join or leave. */
  voiceTitle?: string;
  onVoiceClick?: () => void;
};

const formatClock = (date: Date): string =>
  `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;

// 24-hour clock that ticks on the minute boundary rather than every second.
function useClock(): string {
  const [clock, setClock] = useState(() => formatClock(new Date()));

  useEffect(() => {
    let timer: number;
    const schedule = () => {
      timer = window.setTimeout(
        () => {
          setClock(formatClock(new Date()));
          schedule();
        },
        60_000 - (Date.now() % 60_000) + 50
      );
    };
    schedule();
    return () => window.clearTimeout(timer);
  }, []);

  return clock;
}

export function StatusBar({
  streams,
  voice,
  voiceStatus = 'disconnected',
  voiceError,
  voiceTitle,
  onVoiceClick,
}: StatusBarProps) {
  const clock = useClock();

  let voiceLabel = 'voice --';
  if (voice) voiceLabel = `${voice.channel} ${voice.users}`;
  else if (voiceStatus === 'connecting') voiceLabel = 'voice ...';
  else if (voiceStatus === 'connected') voiceLabel = 'voice';
  const voiceClass = voice ? undefined : 'kolpak-status-bar__idle';
  const buttonTitle = voiceTitle ?? (voice ? 'leave voice' : 'join voice');

  return (
    <footer className="kolpak-status-bar" aria-label="Status">
      <time>{clock}</time>

      {streams && streams.length > 0 ? (
        streams.map((stream) =>
          stream.live ? (
            <span key={stream.name} className="kolpak-status-bar__live">
              <span className="kolpak-status-bar__dot kolpak-round" aria-hidden="true" />
              {stream.name}
              {stream.viewers !== undefined && <span>{stream.viewers}</span>}
            </span>
          ) : (
            <span key={stream.name} className="kolpak-status-bar__idle">
              {stream.name} --
            </span>
          )
        )
      ) : (
        <span className="kolpak-status-bar__idle">streams --</span>
      )}

      <span className="kolpak-status-bar__spacer" />

      {!voice && voiceError && (
        <span className="kolpak-status-bar__idle kolpak-status-bar__error">{voiceError}</span>
      )}
      {onVoiceClick ? (
        <button
          type="button"
          className={['kolpak-status-bar__button', voiceClass].filter(Boolean).join(' ')}
          onClick={onVoiceClick}
          disabled={voiceStatus === 'connecting'}
          title={buttonTitle}
        >
          {voiceLabel}
        </button>
      ) : (
        <span className={voiceClass}>{voiceLabel}</span>
      )}
      {voice?.pingMs !== undefined && <span>{voice.pingMs} ms</span>}
    </footer>
  );
}
