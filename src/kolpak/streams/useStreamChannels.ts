import { useMemo } from 'react';
import { useQueries, useQuery } from '@tanstack/react-query';
import {
  fetchChannelNames,
  fetchChannelStreams,
  orderChannels,
  toChannelStatus,
  type ChannelStatus,
  type StatsStream,
} from './stats';

// Same cadence as the station site.
const POLL_MS = 10_000;
const CHANNEL_LIST_STALE_MS = 5 * 60_000;

// One query per channel, shared by the status bar and the player so they poll once.
const channelQuery = (statsUrl: string | undefined, name: string) => ({
  queryKey: ['kolpak', 'streams', 'channel', statsUrl, name],
  queryFn: ({ signal }: { signal: AbortSignal }) => fetchChannelStreams(statsUrl!, name, signal),
  enabled: Boolean(statsUrl),
  refetchInterval: POLL_MS,
  staleTime: POLL_MS / 2,
  retry: false,
});

/** The streams one channel is serving right now, polled. */
export function useChannelStreams(
  statsUrl: string | undefined,
  name: string | undefined
): StatsStream[] | undefined {
  const query = useQuery({
    ...channelQuery(statsUrl, name ?? ''),
    enabled: Boolean(statsUrl) && Boolean(name),
  });
  return query.data;
}

/**
 * Every channel the stats API lists, with its live state, polled.
 * Returns undefined while there is nothing to show: no URL configured, the first load, or
 * the service being down. A stream outage must never get in the way of chat.
 */
export function useStreamChannels(statsUrl: string | undefined): ChannelStatus[] | undefined {
  const names = useQuery({
    queryKey: ['kolpak', 'streams', 'channel-names', statsUrl],
    queryFn: ({ signal }) => fetchChannelNames(statsUrl!, signal),
    enabled: Boolean(statsUrl),
    staleTime: CHANNEL_LIST_STALE_MS,
    refetchInterval: CHANNEL_LIST_STALE_MS,
    retry: false,
  });

  const channelNames = names.data;

  const results = useQueries({
    queries: (channelNames ?? []).map((name) => channelQuery(statsUrl, name)),
  });

  const signature = results.map((result) => result.dataUpdatedAt).join();

  return useMemo(
    () =>
      channelNames && channelNames.length > 0
        ? orderChannels(
            channelNames.map((name, index) => toChannelStatus(name, results[index]?.data ?? []))
          )
        : undefined,
    // `results` is a new array every render; `signature` changes only when data does.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [channelNames, signature]
  );
}
