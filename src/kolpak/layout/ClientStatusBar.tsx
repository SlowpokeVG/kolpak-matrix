import { useMemo } from 'react';
import { useClientConfig } from '$hooks/useClientConfig';
import { useStreamChannels } from '../streams/useStreamChannels';
import { StatusBar, type StatusBarStream } from './StatusBar';

// The status bar wired to live data. Streams come from the stats API named in
// config.json (`streamStatsUrl`); voice stays empty until the Mumble bridge exists.
export function ClientStatusBar() {
  const { streamStatsUrl } = useClientConfig();
  const channels = useStreamChannels(streamStatsUrl);

  const streams = useMemo<StatusBarStream[] | undefined>(
    () =>
      channels?.map((channel) => ({
        name: channel.name,
        live: channel.live,
        viewers: channel.live ? channel.viewers : undefined,
      })),
    [channels]
  );

  return <StatusBar streams={streams} />;
}
