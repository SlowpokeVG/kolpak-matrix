import type { StreamSource } from './stats';

// Attaching a stream to a <video>. One function per protocol; each player library is
// loaded only when it is first needed, so chat-only use never downloads them.

export type StopPlayer = () => void;

const play = (video: HTMLVideoElement): void => {
  void video.play().catch(() => {
    // Autoplay can be refused; the user's next click on the video starts it.
  });
};

async function attachFlv(
  video: HTMLVideoElement,
  url: string,
  onError: () => void
): Promise<StopPlayer> {
  const { default: mpegts } = await import('mpegts.js');
  if (!mpegts.isSupported()) throw new Error('this webview cannot play FLV');
  const player = mpegts.createPlayer(
    // `ws://` and `wss://` URLs are fetched over a WebSocket, which is how the service
    // serves its low-delay FLV.
    { type: 'flv', url, isLive: true, cors: true },
    {
      // Stay near the live edge instead of drifting behind.
      liveBufferLatencyChasing: true,
      liveBufferLatencyMaxLatency: 3,
      liveBufferLatencyMinRemain: 0.5,
    }
  );
  player.on(mpegts.Events.ERROR, onError);
  player.attachMediaElement(video);
  player.load();
  play(video);
  return () => {
    player.pause();
    player.unload();
    player.detachMediaElement();
    player.destroy();
  };
}

async function attachHls(
  video: HTMLVideoElement,
  url: string,
  onError: () => void
): Promise<StopPlayer> {
  // macOS and iOS webviews play HLS themselves.
  if (video.canPlayType('application/vnd.apple.mpegurl')) {
    video.src = url;
    play(video);
    return () => {
      video.pause();
      video.removeAttribute('src');
      video.load();
    };
  }
  const { default: Hls } = await import('hls.js');
  if (!Hls.isSupported()) throw new Error('this webview cannot play HLS');
  const hls = new Hls({ lowLatencyMode: true, liveSyncDurationCount: 2 });
  hls.on(Hls.Events.ERROR, (_, data) => {
    if (data.fatal) onError();
  });
  hls.loadSource(url);
  hls.attachMedia(video);
  play(video);
  return () => {
    hls.stopLoad();
    hls.destroy();
  };
}

/** Start playing `source` in `video`. The returned function stops and releases it. */
export function attachStream(
  video: HTMLVideoElement,
  source: StreamSource,
  onError: () => void
): Promise<StopPlayer> {
  return source.protocol === 'flv'
    ? attachFlv(video, source.url, onError)
    : attachHls(video, source.url, onError);
}
