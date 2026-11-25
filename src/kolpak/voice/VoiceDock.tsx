import { useCallback, useMemo, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { buildTreeRows } from './tree';
import { useVoiceSettings } from './useVoiceSettings';
import { VoiceButtons } from './VoiceButtons';
import { connectVoice, disconnectVoice, useVoice } from './voiceStore';
import './voice-dock.css';

// The VOICE half of the live dock (AI/DESIGN.md §3.4): the Mumble channel tree as a text
// outline, with join and leave. Click a channel's name to move there; click its marker to
// fold it. The stream half is ../streams/StreamDock.tsx.
//
// Your microphone is sent when the mic button is on and the transmit mode lets it
// through. Whoever is speaking, you included, is shown in green. Deafening stops playback.

const INDENT_PX = 17;

// One 1px guide per level, drawn as background stripes so rows stay flat in the DOM.
const guides = (depth: number) =>
  depth === 0
    ? undefined
    : {
        backgroundImage: Array.from(
          { length: depth },
          () =>
            'linear-gradient(var(--kolpak-line, currentColor), var(--kolpak-line, currentColor))'
        ).join(', '),
        backgroundSize: Array.from({ length: depth }, () => '1px 100%').join(', '),
        backgroundPosition: Array.from(
          { length: depth },
          (_, level) => `${level * INDENT_PX + 5}px 0`
        ).join(', '),
        backgroundRepeat: 'no-repeat',
      };

export function VoiceDock() {
  const voice = useVoice();
  const settings = useVoiceSettings();
  const [collapsed, setCollapsed] = useState<ReadonlySet<number>>(() => new Set());

  const rows = useMemo(
    () =>
      buildTreeRows(voice.snapshot, collapsed, {
        talking: voice.talking,
        transmitting: voice.transmitting,
      }),
    [voice.snapshot, collapsed, voice.talking, voice.transmitting]
  );

  const toggleFold = useCallback((id: number) => {
    setCollapsed((previous) => {
      const next = new Set(previous);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const joinChannel = useCallback((channelId: number) => {
    void invoke('mumble_join_channel', { channelId }).catch(() => undefined);
  }, []);

  const canConnect = Boolean(settings.host) && Boolean(settings.username);
  const join = useCallback(() => {
    void connectVoice({ host: settings.host, port: settings.port, username: settings.username });
  }, [settings.host, settings.port, settings.username]);

  return (
    <section className="kolpak-dock__voice" aria-label="Voice">
      <div className="kolpak-dock__label">Voice</div>

      {voice.status !== 'connected' && (
        <div className="kolpak-dock__offline">
          <p className="kolpak-dock__note">
            {voice.status === 'connecting'
              ? 'connecting.'
              : (voice.error ?? 'nobody is listening.')}
          </p>
          <button
            type="button"
            className="kolpak-dock__button"
            onClick={join}
            disabled={!canConnect || voice.status === 'connecting'}
          >
            Join voice
          </button>
          {!canConnect && (
            <p className="kolpak-dock__note">set a server and a name in settings → voice.</p>
          )}
        </div>
      )}

      {voice.status === 'connected' && (
        <>
          <ul className="kolpak-tree">
            {rows.map((row) =>
              row.kind === 'channel' ? (
                <li
                  key={`c${row.id}`}
                  className="kolpak-tree__row kolpak-tree__row--channel"
                  data-current={row.current ? 'true' : undefined}
                  style={{ paddingLeft: row.depth * INDENT_PX, ...guides(row.depth) }}
                >
                  <button
                    type="button"
                    className="kolpak-tree__fold"
                    onClick={() => toggleFold(row.id)}
                    disabled={!row.foldable}
                    aria-label={row.collapsed ? `expand ${row.name}` : `collapse ${row.name}`}
                    aria-expanded={!row.collapsed}
                  >
                    {row.collapsed ? '+' : '-'}
                  </button>
                  <button
                    type="button"
                    className="kolpak-tree__name"
                    onClick={() => joinChannel(row.id)}
                    disabled={row.current}
                    title={row.current ? 'you are here' : `move to ${row.name}`}
                  >
                    {row.name}
                  </button>
                  <span className="kolpak-tree__count">{row.userCount}</span>
                </li>
              ) : (
                <li
                  key={`u${row.session}`}
                  className="kolpak-tree__row kolpak-tree__row--user"
                  data-state={row.state}
                  data-self={row.self ? 'true' : undefined}
                  data-talking={row.talking ? 'true' : undefined}
                  style={{ paddingLeft: row.depth * INDENT_PX, ...guides(row.depth) }}
                >
                  <span className="kolpak-tree__user">
                    {row.name}
                    {row.state !== 'open' && ` (${row.state})`}
                  </span>
                </li>
              )
            )}
          </ul>

          {voice.captureError && <p className="kolpak-dock__note">{voice.captureError}.</p>}
          {voice.outputError && <p className="kolpak-dock__note">{voice.outputError}.</p>}
          <div className="kolpak-dock__controls">
            <VoiceButtons />
            <button
              type="button"
              className="kolpak-dock__button kolpak-dock__leave"
              onClick={() => void disconnectVoice()}
            >
              Leave
            </button>
          </div>
        </>
      )}
    </section>
  );
}
