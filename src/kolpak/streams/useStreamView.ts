import { useEffect, useMemo, useState } from 'react';
import { useClientConfig } from '$hooks/useClientConfig';
import { playStream, sourceKeyOf, stopStream, usePlayer } from './sharedPlayer';
import {
  pickSource,
  playableProtocols,
  uptimeSeconds,
  type ChannelStatus,
  type PlayableProtocol,
  type StatsStream,
  type StreamSource,
} from './stats';
import { usePreferredProtocol, useSelectedStreamChannel } from './streamStore';
import { useChannelStreams, useStreamChannels } from './useStreamChannels';

/**
 * The clock for the uptime counter. Kolpak: it ticks only while there is an uptime to count
 * and the page can be seen; it used to re-render the dock every second, off air and hidden.
 */
function useNow(intervalMs: number, enabled: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  const [visible, setVisible] = useState(() => document.visibilityState !== 'hidden');
  useEffect(() => {
    const onVisibility = () => setVisible(document.visibilityState !== 'hidden');
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, []);
  useEffect(() => {
    if (!enabled || !visible) return undefined;
    const tick = () => setNow(Date.now());
    const first = window.setTimeout(tick, 0);
    const timer = window.setInterval(tick, intervalMs);
    return () => {
      window.clearTimeout(first);
      window.clearInterval(timer);
    };
  }, [intervalMs, enabled, visible]);
  return now;
}

/** The picked channel if it still exists, else the busiest live one, else the first. */
export function chooseChannel(
  channels: ChannelStatus[] | undefined,
  picked: string | null
): string | undefined {
  if (!channels || channels.length === 0) return picked ?? undefined;
  if (picked && channels.some((channel) => channel.name === picked)) return picked;
  return channels[0]?.name;
}

export type StreamView = {
  statsUrl: string | undefined;
  channels: ChannelStatus[] | undefined;
  channel: string | undefined;
  live: boolean;
  viewers: number;
  /** The source that would be played for this channel, if any. */
  source: StreamSource | undefined;
  /** Protocols this channel offers that the player can use. */
  protocols: PlayableProtocol[];
  /** The stats entry that matches the source, for bitrate and streamer. */
  main: StatsStream | undefined;
  uptime: number | undefined;
};

/**
 * Everything the dock and theater mode show about the selected channel, and the rule that
 * keeps the shared player on it: once something is playing, picking another channel or
 * format switches the player to it, and a channel going off air stops it.
 */
export function useStreamView(): StreamView {
  const { streamStatsUrl } = useClientConfig();
  const channels = useStreamChannels(streamStatsUrl);
  const picked = useSelectedStreamChannel();
  const prefer = usePreferredProtocol();
  const channel = chooseChannel(channels, picked);
  const streams = useChannelStreams(streamStatsUrl, channel);
  const player = usePlayer();

  const status = channels?.find((entry) => entry.name === channel);
  const live = Boolean(status?.live);
  const now = useNow(1000, live);
  const source = useMemo(
    () => (live && streams ? pickSource(streams, prefer ?? undefined) : undefined),
    [live, streams, prefer]
  );
  const protocols = useMemo(() => (streams ? playableProtocols(streams) : []), [streams]);
  const main = streams?.find((entry) => entry.protocol === source?.protocol) ?? streams?.[0];
  const sourceKey = source ? sourceKeyOf(source) : null;

  useEffect(() => {
    if (player.status === 'idle' || player.sourceKey === sourceKey) return;
    if (source) playStream(source);
    else stopStream();
    // `source` is identified by `sourceKey`; a new poll result must not restart playback.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sourceKey, player.status, player.sourceKey]);

  return {
    statsUrl: streamStatsUrl,
    channels,
    channel,
    live,
    viewers: status?.viewers ?? 0,
    source,
    protocols,
    main,
    uptime: live ? uptimeSeconds(main, now) : undefined,
  };
}
