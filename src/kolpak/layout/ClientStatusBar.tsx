import { useEffect, useMemo } from 'react';
import { useClientConfig } from '$hooks/useClientConfig';
import { isDesktopTauri } from '$utils/platform';
import { useStreamChannels } from '../streams/useStreamChannels';
import { currentChannelSummary } from '../voice/types';
import { useVoiceSettings } from '../voice/useVoiceSettings';
import { useVoiceRuntime } from '../voice/useVoiceRuntime';
import { connectVoice, useVoice } from '../voice/voiceStore';
import { selectStreamChannel } from '../streams/streamStore';
import { setDockOpen, toggleDock } from './dockStore';
import { StatusBar, type StatusBarStream, type StatusBarVoice } from './StatusBar';

// "Join voice on startup" runs once per app start, not on every remount of the bar.
let autoConnectDone = false;

// The status bar wired to live data: streams from the stats API named in config.json
// (`streamStatsUrl`), voice from the Mumble bridge. Clicking the voice entry opens or
// closes the dock, where the channel tree and the join and leave buttons are.
export function ClientStatusBar() {
  const { streamStatsUrl } = useClientConfig();
  const channels = useStreamChannels(streamStatsUrl);
  const voiceState = useVoice();
  const settings = useVoiceSettings();
  const desktop = isDesktopTauri();

  // The status bar is always mounted on desktop, which makes it the home of the voice runtime.
  useVoiceRuntime();

  useEffect(() => {
    if (autoConnectDone || !desktop) return;
    if (!settings.autoConnect || !settings.host || !settings.username) return;
    autoConnectDone = true;
    void connectVoice({ host: settings.host, port: settings.port, username: settings.username });
  }, [desktop, settings.autoConnect, settings.host, settings.port, settings.username]);

  const streams = useMemo<StatusBarStream[] | undefined>(
    () =>
      channels?.map((channel) => ({
        name: channel.name,
        live: channel.live,
        viewers: channel.live ? channel.viewers : undefined,
      })),
    [channels]
  );

  const voice = useMemo<StatusBarVoice | undefined>(() => {
    if (voiceState.status !== 'connected') return undefined;
    const summary = currentChannelSummary(voiceState.snapshot);
    if (!summary) return undefined;
    return {
      ...summary,
      pingMs: voiceState.pingMs === undefined ? undefined : Math.round(voiceState.pingMs),
    };
  }, [voiceState]);

  return (
    <StatusBar
      streams={streams}
      voice={voice}
      voiceStatus={voiceState.status}
      voiceError={voiceState.error}
      voiceTitle="show or hide voice"
      onVoiceClick={desktop ? toggleDock : undefined}
      onStreamClick={
        desktop
          ? (name) => {
              selectStreamChannel(name);
              setDockOpen(true);
            }
          : undefined
      }
    />
  );
}
