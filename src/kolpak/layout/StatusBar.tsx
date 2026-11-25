import { useEffect, useState } from 'react';
import './status-bar.css';

// The inverted bar along the bottom of the window (AI/DESIGN.md §3.5):
// clock · stream channels · (right) voice channel · latency.
// Streams and voice have no data source yet; until the stream provider and the Mumble
// bridge exist the bar shows the clock and "--" placeholders.

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

type StatusBarProps = {
  streams?: StatusBarStream[];
  voice?: StatusBarVoice;
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

export function StatusBar({ streams, voice }: StatusBarProps) {
  const clock = useClock();

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

      {voice ? (
        <>
          <span>
            {voice.channel} {voice.users}
          </span>
          {voice.pingMs !== undefined && <span>{voice.pingMs} ms</span>}
        </>
      ) : (
        <span className="kolpak-status-bar__idle">voice --</span>
      )}
    </footer>
  );
}
