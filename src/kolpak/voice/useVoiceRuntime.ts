import { useEffect } from 'react';
import { isDesktopTauri } from '$utils/platform';
import { useVoiceSettings } from './useVoiceSettings';
import {
  applyOutputSettings,
  applyTransmitSettings,
  setPushToTalk,
  startVoiceBridge,
} from './voiceStore';

/**
 * Keeps the native voice side in step with the settings, for as long as the client is
 * mounted: starts the event bridge, pushes transmit settings whenever they change, and
 * watches the push-to-talk key.
 *
 * On Windows the native side reads the push-to-talk key itself, system-wide, and ignores
 * what this listener reports. Elsewhere this listener is all there is, so push to talk
 * only works while a Kolpak window has focus.
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
      pttKey: settings.pttKey,
      noiseSuppression: settings.noiseSuppression,
    });
  }, [
    settings.transmitMode,
    settings.vadThreshold,
    settings.inputDevice,
    settings.pttKey,
    settings.noiseSuppression,
  ]);

  useEffect(() => {
    void applyOutputSettings(settings.outputDevice, settings.outputVolume);
  }, [settings.outputDevice, settings.outputVolume]);

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
