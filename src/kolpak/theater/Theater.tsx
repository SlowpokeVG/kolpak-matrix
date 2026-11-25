import { useMemo } from 'react';
import { useLocation } from 'react-router';
import { useMatrixClient } from '$hooks/useMatrixClient';
import { getCanonicalAliasRoomId, isRoomAlias } from '$utils/matrix';
import { formatTape, type PlayableProtocol } from '../streams/stats';
import { StreamPicture } from '../streams/StreamPicture';
import { selectStreamChannel, setPreferredProtocol } from '../streams/streamStore';
import { useStreamView } from '../streams/useStreamView';
import { useVoice } from '../voice/voiceStore';
import { closeTheater, useTheater } from './theaterStore';
import { TheaterChat } from './TheaterChat';
import { VoiceStrip } from './VoiceStrip';
import '../streams/stream-dock.css';
import '../voice/voice-dock.css';
import './theater.css';

// Theater mode (AI/DESIGN.md §4): the stream large, the channels under it, a one-line voice
// strip, and a chat room in a 320px column on the right. It takes the place of the room
// list and the room; the space rail and the status bar stay. The player is the same one
// the dock uses, moved here, so the stream does not restart.

const FORMATS: { protocol: PlayableProtocol | 'dash'; label: string }[] = [
  { protocol: 'flv', label: 'FLV' },
  { protocol: 'hls', label: 'HLS' },
  { protocol: 'dash', label: 'DASH' },
];

/** The room open in the client, read from the address since this sits outside the routes. */
function useRoomInAddress(): string | undefined {
  const mx = useMatrixClient();
  const { pathname } = useLocation();
  return useMemo(() => {
    const segments = pathname
      .split('/')
      .filter(Boolean)
      .map((segment) => {
        try {
          return decodeURIComponent(segment);
        } catch {
          return segment;
        }
      });
    const last = segments.toReversed().find((segment) => /^[!#]/.test(segment));
    if (!last) return undefined;
    return isRoomAlias(last) ? getCanonicalAliasRoomId(mx, last) : last;
  }, [mx, pathname]);
}

export function Theater() {
  const view = useStreamView();
  const theater = useTheater();
  const addressRoom = useRoomInAddress();
  const voice = useVoice();
  const roomId = theater.roomId ?? addressRoom;

  const talking = useMemo(() => {
    const names = new Set<string>();
    for (const user of voice.snapshot.users) {
      const isTalking =
        user.session === voice.snapshot.session
          ? voice.transmitting
          : voice.talking.includes(user.session);
      if (isTalking) names.add(user.name.toLowerCase());
    }
    return names;
  }, [voice.snapshot, voice.talking, voice.transmitting]);

  const title = view.main?.userName ?? view.channel ?? '--';

  return (
    <div className="kolpak-theater">
      <section className="kolpak-theater__main" aria-label="Theater">
        <header className="kolpak-theater__head">
          {view.live ? (
            <span className="kolpak-onair">
              <span className="kolpak-onair__dot kolpak-round" aria-hidden="true" />
              ON AIR
            </span>
          ) : (
            <span className="kolpak-stream__offair">OFF AIR</span>
          )}
          <h1 className="kolpak-theater__title">{title}</h1>
          {view.live && (
            <span className="kolpak-theater__stats">
              <span title="viewers">{view.viewers}</span>
              <span title="on air for">
                {view.uptime === undefined ? '--' : formatTape(view.uptime)}
              </span>
              <span title="bitrate, kbit/s">
                {view.main?.bitrate ? view.main.bitrate.toLocaleString('en-US') : '--'}
              </span>
            </span>
          )}
          <span className="kolpak-theater__formats" role="group" aria-label="Format">
            {FORMATS.map((format) => {
              const available =
                format.protocol !== 'dash' && view.protocols.includes(format.protocol);
              return (
                <button
                  key={format.protocol}
                  type="button"
                  aria-pressed={view.source?.protocol === format.protocol}
                  disabled={!available}
                  title={
                    available
                      ? `play as ${format.label}`
                      : `${format.label} is not offered for this channel`
                  }
                  onClick={() =>
                    format.protocol !== 'dash' && setPreferredProtocol(format.protocol)
                  }
                >
                  {format.label}
                </button>
              );
            })}
          </span>
          <button type="button" className="kolpak-theater__button" onClick={closeTheater}>
            EXIT THEATER
          </button>
        </header>

        <div className="kolpak-theater__body">
          <StreamPicture
            source={view.source}
            live={view.live}
            className="kolpak-theater__picture"
          />

          <div className="kolpak-theater__channels">
            <span className="kolpak-theater__label">Channels</span>
            {view.channels?.map((entry) => (
              <button
                key={entry.name}
                type="button"
                className="kolpak-theater__chip"
                aria-pressed={entry.name === view.channel}
                data-live={entry.live ? 'true' : undefined}
                onClick={() => selectStreamChannel(entry.name)}
              >
                {entry.live && (
                  <span className="kolpak-onair__dot kolpak-round" aria-hidden="true" />
                )}
                {entry.live ? `${entry.name} ${entry.viewers}` : `${entry.name} --`}
              </button>
            ))}
          </div>

          <VoiceStrip />
        </div>
      </section>

      <TheaterChat
        roomId={roomId}
        talking={talking}
        streamer={view.live ? view.main?.userName?.toLowerCase() : undefined}
      />
    </div>
  );
}
