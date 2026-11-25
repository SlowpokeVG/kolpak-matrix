import { useRef } from 'react';
import { playStream, sourceKeyOf, stopStream, usePlayer, usePlayerHost } from './sharedPlayer';
import type { StreamSource } from './stats';

// The picture: the shared <video> when something is playing, a play triangle when not.
// Used by the dock and by theater mode; only one is on screen at a time.

type StreamPictureProps = {
  source: StreamSource | undefined;
  live: boolean;
  className?: string;
};

export function StreamPicture({ source, live, className }: StreamPictureProps) {
  const host = useRef<HTMLDivElement>(null);
  const player = usePlayer();
  usePlayerHost(host);

  const ours = source !== undefined && player.sourceKey === sourceKeyOf(source);
  const showing = ours && player.status !== 'idle';

  return (
    <div
      className={['kolpak-stream__picture', className].filter(Boolean).join(' ')}
      data-live={live ? 'true' : undefined}
      data-status={showing ? player.status : 'idle'}
    >
      <div ref={host} className="kolpak-stream__host" />
      {!showing && (
        <button
          type="button"
          className="kolpak-stream__play"
          onClick={() => source && playStream(source)}
          disabled={!source}
          aria-label={source ? 'Watch the stream' : 'Nothing to watch'}
        >
          {source ? (
            <svg viewBox="0 0 24 24" width="32" height="32" aria-hidden="true">
              <path d="M7 4L20 12L7 20Z" />
            </svg>
          ) : (
            <span className="kolpak-stream__note">{live ? 'no playable source.' : 'off air.'}</span>
          )}
        </button>
      )}
      {showing && player.status === 'loading' && (
        <span className="kolpak-stream__overlay">tuning in.</span>
      )}
      {showing && player.status === 'error' && (
        <button type="button" className="kolpak-stream__overlay" onClick={stopStream}>
          lost the signal. click to stop.
        </button>
      )}
    </div>
  );
}
