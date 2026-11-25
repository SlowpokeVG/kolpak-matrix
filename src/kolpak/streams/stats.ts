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
