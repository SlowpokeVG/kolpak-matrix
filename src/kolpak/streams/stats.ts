// The community stream service's stats API, as the station site (klpq/klpq-angular) uses it.
//
//   GET {base}/streams?limit=1      broadcast history; `options.channels` lists every channel
//   GET {base}/channels/{name}      `{ streams: [...] }`, one entry per protocol currently
//                                   being served; an empty list means the channel is off air
//
// The API answers with `Access-Control-Allow-Origin: *`, so the webview polls it directly.
// Pure functions and fetchers only: no React here.

export type StatsStream = {
  app: string;
  protocol: string;
  viewers?: number;
  duration?: number;
  bitrate?: number;
  startTime?: string;
  userName?: string;
  urls?: { edge?: string; web?: string };
};

export type ChannelStatus = {
  name: string;
  live: boolean;
  /** Everyone watching the channel, summed over all of its streams. */
  viewers: number;
};

/** Protocols a webview can play: HTTP-FLV (also over WebSocket), HLS and DASH. */
export const PLAYABLE_PROTOCOLS = ['flv', 'hls', 'mpd'] as const;

export function toChannelStatus(name: string, streams: StatsStream[]): ChannelStatus {
  return {
    name,
    live: streams.length > 0,
    viewers: streams.reduce((total, stream) => total + (stream.viewers || 0), 0),
  };
}

/** On air first, busiest first; then the rest by name. */
export function orderChannels(channels: ChannelStatus[]): ChannelStatus[] {
  return channels.toSorted((a, b) => {
    if (a.live !== b.live) return a.live ? -1 : 1;
    if (a.viewers !== b.viewers) return b.viewers - a.viewers;
    return a.name.localeCompare(b.name);
  });
}

export type PlayableProtocol = (typeof PLAYABLE_PROTOCOLS)[number];

export type StreamSource = {
  protocol: PlayableProtocol;
  url: string;
};

/**
 * The best source the webview can play. HTTP-FLV (here usually FLV over WebSocket) has the
 * least delay, then HLS. DASH is listed by the service but not played yet: it would need a
 * third player library and the service has not been seen offering it.
 */
export function pickSource(
  streams: StatsStream[],
  prefer?: PlayableProtocol
): StreamSource | undefined {
  const order: PlayableProtocol[] = prefer ? [prefer, 'flv', 'hls'] : ['flv', 'hls'];
  for (const protocol of order) {
    const stream = streams.find((entry) => entry.protocol === protocol && entry.urls?.edge);
    if (stream?.urls?.edge) return { protocol, url: stream.urls.edge };
  }
  return undefined;
}

/** The protocols a channel offers that this player can use, in preference order. */
export function playableProtocols(streams: StatsStream[]): PlayableProtocol[] {
  return (['flv', 'hls'] as const).filter((protocol) =>
    streams.some((entry) => entry.protocol === protocol && entry.urls?.edge)
  );
}

/** Seconds on air at `now`, from the stream's start time when it has one. */
export function uptimeSeconds(stream: StatsStream | undefined, now: number): number | undefined {
  if (!stream) return undefined;
  const started = stream.startTime ? Date.parse(stream.startTime) : Number.NaN;
  if (!Number.isNaN(started)) return Math.max(0, Math.floor((now - started) / 1000));
  return stream.duration;
}

/** Seconds as a tape counter: 01:24:07. */
export function formatTape(seconds: number): string {
  const whole = Math.max(0, Math.floor(seconds));
  return [Math.floor(whole / 3600), Math.floor(whole / 60) % 60, whole % 60]
    .map((part) => String(part).padStart(2, '0'))
    .join(':');
}

const trimBase = (baseUrl: string): string => baseUrl.replace(/\/+$/, '');

export async function fetchChannelNames(baseUrl: string, signal?: AbortSignal): Promise<string[]> {
  const response = await fetch(`${trimBase(baseUrl)}/streams?limit=1`, { signal });
  if (!response.ok) throw new Error(`stream stats ${response.status}`);
  const body = (await response.json()) as { options?: { channels?: unknown } };
  const channels = body.options?.channels;
  return Array.isArray(channels)
    ? channels.filter((name): name is string => typeof name === 'string')
    : [];
}

export async function fetchChannelStreams(
  baseUrl: string,
  name: string,
  signal?: AbortSignal
): Promise<StatsStream[]> {
  const response = await fetch(`${trimBase(baseUrl)}/channels/${encodeURIComponent(name)}`, {
    signal,
  });
  if (!response.ok) throw new Error(`stream stats ${response.status}`);
  const body = (await response.json()) as { streams?: unknown };
  return Array.isArray(body.streams) ? (body.streams as StatsStream[]) : [];
}
