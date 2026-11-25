import { formatTape } from './stats';
import { StreamPicture } from './StreamPicture';
import { playStream } from './sharedPlayer';
import { selectStreamChannel } from './streamStore';
import { useStreamView } from './useStreamView';
import { openTheater } from '../theater/theaterStore';
import './stream-dock.css';

// The stream half of the live dock (AI/DESIGN.md §3.4): ON AIR tag and channel, a 16:9
// video with an orange border while live, then viewers · uptime · bitrate, and WATCH,
// which opens theater mode.
//
// Nothing plays until the user clicks the picture or WATCH: a stream costs bandwidth and
// makes noise, and the dock is open all the time.

export function StreamDock() {
  const view = useStreamView();
  if (!view.statsUrl) return null;

  const watch = () => {
    if (view.source) playStream(view.source);
    openTheater();
  };

  return (
    <section className="kolpak-stream" aria-label="Stream">
      <div className="kolpak-stream__head">
        {view.live ? (
          <span className="kolpak-onair">
            <span className="kolpak-onair__dot kolpak-round" aria-hidden="true" />
            ON AIR
          </span>
        ) : (
          <span className="kolpak-stream__offair">OFF AIR</span>
        )}
        {view.channels && view.channels.length > 1 ? (
          <select
            className="kolpak-stream__channel"
            aria-label="Stream channel"
            value={view.channel ?? ''}
            onChange={(event) => selectStreamChannel(event.target.value)}
          >
            {view.channels.map((entry) => (
              <option key={entry.name} value={entry.name}>
                {entry.live ? `${entry.name} · live` : entry.name}
              </option>
            ))}
          </select>
        ) : (
          <span className="kolpak-stream__name">{view.channel ?? '--'}</span>
        )}
      </div>

      <StreamPicture source={view.source} live={view.live} />

      <div className="kolpak-stream__stats">
        {view.live ? (
          <>
            <span title="viewers">{view.viewers}</span>
            <span title="on air for">
              {view.uptime === undefined ? '--' : formatTape(view.uptime)}
            </span>
            <span title="bitrate, kbit/s">
              {view.main?.bitrate ? view.main.bitrate.toLocaleString('en-US') : '--'}
            </span>
            <button
              type="button"
              className="kolpak-stream__watch"
              onClick={watch}
              disabled={!view.source}
              title="theater mode"
            >
              WATCH
            </button>
          </>
        ) : (
          <span>nobody is on this channel.</span>
        )}
      </div>
    </section>
  );
}
