import { useCallback, useMemo } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { selfAudioState, toggleSelfDeaf, toggleSelfMute, type SelfAudioState } from './types';
import { useVoice } from './voiceStore';

// The microphone and deafen squares (AI/DESIGN.md §3.4): 44×44, the mic green while live,
// deafen a paper outline that fills while deafened. Shared by the dock and theater mode.
// They show what the server reports about us, never a local guess.

const setSelf = (next: SelfAudioState): void => {
  void invoke('mumble_set_self', next).catch(() => undefined);
};

export function VoiceButtons({ size = 'normal' }: { size?: 'normal' | 'small' }) {
  const voice = useVoice();
  const self = useMemo(() => selfAudioState(voice.snapshot), [voice.snapshot]);
  const toggleMute = useCallback(() => self && setSelf(toggleSelfMute(self)), [self]);
  const toggleDeaf = useCallback(() => self && setSelf(toggleSelfDeaf(self)), [self]);

  return (
    <>
      <button
        type="button"
        className={`kolpak-dock__square kolpak-dock__mic${size === 'small' ? ' kolpak-dock__square--small' : ''}`}
        disabled={!self}
        aria-pressed={self ? !self.mute : false}
        aria-label={self?.mute ? 'unmute microphone' : 'mute microphone'}
        title={self?.mute ? 'muted. click to unmute' : 'microphone on. click to mute'}
        onClick={toggleMute}
      >
        <svg viewBox="0 0 20 20" width="20" height="20" aria-hidden="true">
          <path d="M7 3h6v8H7zM4 9v2a6 6 0 0 0 12 0V9M10 17v2" />
          {self?.mute !== false && <path d="M3 3l14 14" />}
        </svg>
      </button>
      <button
        type="button"
        className={`kolpak-dock__square kolpak-dock__deaf${size === 'small' ? ' kolpak-dock__square--small' : ''}`}
        disabled={!self}
        aria-pressed={self ? self.deaf : false}
        aria-label={self?.deaf ? 'undeafen' : 'deafen'}
        title={self?.deaf ? 'deafened. click to hear again' : 'click to deafen'}
        onClick={toggleDeaf}
      >
        <svg viewBox="0 0 20 20" width="20" height="20" aria-hidden="true">
          <path d="M3 13V10a7 7 0 0 1 14 0v3M3 12h3v5H3zM14 12h3v5h-3z" />
          {self?.deaf !== false && <path d="M3 3l14 14" />}
        </svg>
      </button>
    </>
  );
}
