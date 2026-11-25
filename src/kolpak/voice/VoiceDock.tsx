import { useCallback, useMemo, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { buildTreeRows } from './tree';
import { selfAudioState, toggleSelfDeaf, toggleSelfMute, type SelfAudioState } from './types';
import { useVoiceSettings } from './useVoiceSettings';
import { connectVoice, disconnectVoice, useVoice } from './voiceStore';
import './voice-dock.css';

// The VOICE half of the live dock (AI/DESIGN.md §3.4): the Mumble channel tree as a text
// outline, with join and leave. Click a channel's name to move there; click its marker to
// fold it. The stream half of the dock is not built yet.
//
// Your microphone is sent when the mic button is on (and the transmit mode lets it
// through); your own name turns green while it is. Other people's voice is not played
// yet, so the deafen button only changes the icon others see.

const INDENT_PX = 17;

export function VoiceDock() {
  const voice = useVoice();
  const settings = useVoiceSettings();
  const [collapsed, setCollapsed] = useState<ReadonlySet<number>>(() => new Set());

  const rows = useMemo(() => buildTreeRows(voice.snapshot, collapsed), [voice.snapshot, collapsed]);

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

  const self = useMemo(() => selfAudioState(voice.snapshot), [voice.snapshot]);
  const setSelf = useCallback((next: SelfAudioState) => {
    void invoke('mumble_set_self', next).catch(() => undefined);
  }, []);

  const canConnect = Boolean(settings.host) && Boolean(settings.username);
  const join = useCallback(() => {
    void connectVoice({ host: settings.host, port: settings.port, username: settings.username });
  }, [settings.host, settings.port, settings.username]);

  return (
    <aside className="kolpak-dock" aria-label="Voice">
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
                  style={{ paddingLeft: row.depth * INDENT_PX }}
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
                  data-talking={row.self && voice.transmitting ? 'true' : undefined}
                  style={{ paddingLeft: row.depth * INDENT_PX }}
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
          <div className="kolpak-dock__controls">
            <button
              type="button"
              className="kolpak-dock__square kolpak-dock__mic"
              disabled={!self}
              aria-pressed={self ? !self.mute : false}
              aria-label={self?.mute ? 'unmute microphone' : 'mute microphone'}
              title={self?.mute ? 'muted. click to unmute' : 'microphone on. click to mute'}
              onClick={() => self && setSelf(toggleSelfMute(self))}
            >
              <svg viewBox="0 0 20 20" width="20" height="20" aria-hidden="true">
                <path d="M7 3h6v8H7zM4 9v2a6 6 0 0 0 12 0V9M10 17v2" />
                {self?.mute !== false && <path d="M3 3l14 14" />}
              </svg>
            </button>
            <button
              type="button"
              className="kolpak-dock__square kolpak-dock__deaf"
              disabled={!self}
              aria-pressed={self ? self.deaf : false}
              aria-label={self?.deaf ? 'undeafen' : 'deafen'}
              title={self?.deaf ? 'deafened. click to hear again' : 'click to deafen'}
              onClick={() => self && setSelf(toggleSelfDeaf(self))}
            >
              <svg viewBox="0 0 20 20" width="20" height="20" aria-hidden="true">
                <path d="M3 13V10a7 7 0 0 1 14 0v3M3 12h3v5H3zM14 12h3v5h-3z" />
                {self?.deaf !== false && <path d="M3 3l14 14" />}
              </svg>
            </button>
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
    </aside>
  );
}
