import { useEffect } from 'react';
import { isDesktopTauri } from '$utils/platform';
import { useVoiceSettings } from './useVoiceSettings';
import { applyTransmitSettings, setPushToTalk, startVoiceBridge } from './voiceStore';

/**
 * Keeps the native voice side in step with the settings, for as long as the client is
 * mounted: starts the event bridge, pushes transmit settings whenever they change, and
 * watches the push-to-talk key.
 *
 * Push to talk works while a Kolpak window has focus. A system-wide hotkey that works
 * from other apps is not built yet.
 */
export function useVoiceRuntime(): void {
  const settings = useVoiceSettings();

  useEffect(() => {
    startVoiceBridge();
  }, []);

  useEffect(() => {
    void applyTransmitSettings({
      mode: settings.transmitMode,
      vadThreshold: settings.vadThreshold,
      inputDevice: settings.inputDevice,
    });
  }, [settings.transmitMode, settings.vadThreshold, settings.inputDevice]);

  useEffect(() => {
    if (!isDesktopTauri() || settings.transmitMode !== 'ptt' || !settings.pttKey) {
      return undefined;
    }
    let held = false;
    const release = () => {
      if (!held) return;
      held = false;
      setPushToTalk(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.code !== settings.pttKey || held) return;
      held = true;
      setPushToTalk(true);
    };
    const onKeyUp = (event: KeyboardEvent) => {
      if (event.code === settings.pttKey) release();
    };
    window.addEventListener('keydown', onKeyDown, true);
    window.addEventListener('keyup', onKeyUp, true);
    // Losing focus while the key is down would otherwise leave the microphone open.
    window.addEventListener('blur', release);
    return () => {
      window.removeEventListener('keydown', onKeyDown, true);
      window.removeEventListener('keyup', onKeyUp, true);
      window.removeEventListener('blur', release);
      release();
    };
  }, [settings.transmitMode, settings.pttKey]);
}
