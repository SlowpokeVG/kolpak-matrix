import { useCallback, useEffect, useMemo, useRef, type PointerEvent } from 'react';
import { selfAudioState } from './types';
import { useVoiceSettings } from './useVoiceSettings';
import { setPushToTalk, useVoice } from './voiceStore';

// Push to talk on a touch screen: hold the button to send, let go to stop. For the Android
// app, which has no key to hold. Shown only in voice with Transmit set to push to talk.
//
// The pointer is captured on press, so sliding a finger off the button does not cut the
// sound; lifting it, the system cancelling the touch, or the app going to the background
// does.

export function TalkButton({ variant = 'big' }: { variant?: 'big' | 'bar' }) {
  const voice = useVoice();
  const settings = useVoiceSettings();
  const self = useMemo(() => selfAudioState(voice.snapshot), [voice.snapshot]);
  const held = useRef(false);

  const release = useCallback(() => {
    if (!held.current) return;
    held.current = false;
    setPushToTalk(false);
  }, []);

  const press = useCallback((event: PointerEvent<HTMLButtonElement>) => {
    event.preventDefault();
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      // Capture is a nicety; without it lifting the finger on the button still releases.
    }
    if (held.current) return;
    held.current = true;
    setPushToTalk(true);
  }, []);

  useEffect(() => {
    const onHidden = () => {
      if (document.hidden) release();
    };
    document.addEventListener('visibilitychange', onHidden);
    return () => {
      document.removeEventListener('visibilitychange', onHidden);
      release();
    };
  }, [release]);

  if (voice.status !== 'connected' || settings.transmitMode !== 'ptt') return null;

  // Self-muted: holding would send nothing, so say what is in the way.
  const micOff = !self || self.mute;
  let label = 'HOLD TO TALK';
  if (micOff) label = 'MIC OFF';
  else if (voice.transmitting) label = 'TALKING';

  return (
    <button
      type="button"
      className={`kolpak-talk kolpak-talk--${variant}`}
      data-transmitting={voice.transmitting ? 'true' : undefined}
      disabled={micOff}
      aria-label={micOff ? 'microphone is off' : 'hold to talk'}
      title={micOff ? 'turn the microphone on to talk' : 'hold to talk'}
      onPointerDown={press}
      onPointerUp={release}
      onPointerCancel={release}
      onLostPointerCapture={release}
      onContextMenu={(event) => event.preventDefault()}
    >
      {label}
    </button>
  );
}
