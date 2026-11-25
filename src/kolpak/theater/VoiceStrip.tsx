import { useEffect, useMemo, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { buildTreeRows } from '../voice/tree';
import { currentChannelSummary } from '../voice/types';
import { useVoiceSettings } from '../voice/useVoiceSettings';
import { VoiceButtons } from '../voice/VoiceButtons';
import { connectVoice, useVoice } from '../voice/voiceStore';

// The voice line under the stream in theater mode: whether you are in voice, and on the
// right the channel you are in (click it to move to another one), then mute and deafen.
// The full tree with everyone in it lives in the dock; this is just enough to stay in
// control while watching.

const NO_FOLDS: ReadonlySet<number> = new Set();

/** How long a refusal from the server stays on the line. */
const DENIED_FOR_MS = 5000;

/** The server's last refusal while it is recent, so a move that did not happen says why. */
function useRecentDenial(denied: { reason: string; at: number } | undefined): string | undefined {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!denied) return undefined;
    const left = denied.at + DENIED_FOR_MS - Date.now();
    if (left <= 0) return undefined;
    setNow(Date.now());
    const timer = window.setTimeout(() => setNow(Date.now()), left);
    return () => window.clearTimeout(timer);
  }, [denied]);
  return denied && now - denied.at < DENIED_FOR_MS ? denied.reason : undefined;
}

function ChannelPicker({ onClose }: { onClose: () => void }) {
  const voice = useVoice();
  const box = useRef<HTMLDivElement>(null);
  const channels = useMemo(
    () => buildTreeRows(voice.snapshot, NO_FOLDS).filter((row) => row.kind === 'channel'),
    [voice.snapshot]
  );

  // Close on Escape or on a click anywhere else. The channel button counts as inside, so
  // pressing it again closes the list through its own toggle instead of closing and reopening.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    const onPointer = (event: PointerEvent) => {
      const inside = box.current?.parentElement ?? box.current;
      if (inside && !inside.contains(event.target as Node)) onClose();
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('pointerdown', onPointer, true);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('pointerdown', onPointer, true);
    };
  }, [onClose]);

  return (
    <div ref={box} className="kolpak-voice-picker" role="dialog" aria-label="Voice channels">
      <ul>
        {channels.map((row) =>
          row.kind === 'channel' ? (
            <li key={row.id}>
              <button
                type="button"
                aria-current={row.current ? 'true' : undefined}
                style={{ paddingLeft: 10 + row.depth * 14 }}
                onClick={() => {
                  if (!row.current) {
                    void invoke('mumble_join_channel', { channelId: row.id }).catch(
                      () => undefined
                    );
                  }
                  onClose();
                }}
              >
                <span className="kolpak-voice-picker__name">{row.name}</span>
                {row.userCount > 0 && <span>{row.userCount}</span>}
              </button>
            </li>
          ) : null
        )}
      </ul>
    </div>
  );
}

export function VoiceStrip() {
  const voice = useVoice();
  const settings = useVoiceSettings();
  const [picking, setPicking] = useState(false);
  const summary = currentChannelSummary(voice.snapshot);
  const connected = voice.status === 'connected' && summary !== undefined;
  const canConnect = Boolean(settings.host) && Boolean(settings.username);
  const refusal = useRecentDenial(voice.denied);

  return (
    <div className="kolpak-voice-strip" data-connected={connected ? 'true' : undefined}>
      <span className="kolpak-voice-strip__state">
        <span className="kolpak-voice-strip__dot kolpak-round" aria-hidden="true" />
        {connected && 'in voice'}
        {!connected && voice.status === 'connecting' && 'joining voice'}
        {!connected && voice.status !== 'connecting' && 'not in voice'}
      </span>
      {connected && refusal && (
        <span className="kolpak-voice-strip__refusal" role="status">
          {refusal}
        </span>
      )}

      <span className="kolpak-voice-strip__right">
        {connected ? (
          <>
            <span className="kolpak-voice-strip__channel-box">
              <button
                type="button"
                className="kolpak-voice-strip__channel"
                aria-haspopup="dialog"
                aria-expanded={picking}
                title="change voice channel"
                onClick={() => setPicking((value) => !value)}
              >
                {summary.channel}
                <svg viewBox="0 0 12 12" width="10" height="10" aria-hidden="true">
                  <path d="M2 4l4 4 4-4" />
                </svg>
              </button>
              {picking && <ChannelPicker onClose={() => setPicking(false)} />}
            </span>
            <VoiceButtons size="small" />
          </>
        ) : (
          <button
            type="button"
            className="kolpak-theater__button"
            disabled={!canConnect || voice.status === 'connecting'}
            onClick={() =>
              void connectVoice({
                host: settings.host,
                port: settings.port,
                username: settings.username,
              })
            }
          >
            JOIN VOICE
          </button>
        )}
      </span>
    </div>
  );
}
