import { useMemo } from 'react';
import { useClientConfig } from '$hooks/useClientConfig';
import { useMatrixClient } from '$hooks/useMatrixClient';
import { getMxIdLocalPart } from '$utils/matrix';
import {
  DEFAULT_MUMBLE_PORT,
  resolveVoiceSettings,
  useStoredVoiceSettings,
  type VoiceDefaults,
  type VoiceSettings,
} from './voiceSettings';

/** Server and name suggested by config.json and the Matrix account. */
export function useVoiceDefaults(): VoiceDefaults {
  const mx = useMatrixClient();
  const { mumble } = useClientConfig();
  const userId = mx.getUserId() ?? '';
  return useMemo(
    () => ({
      host: mumble?.host ?? '',
      port: mumble?.port ?? DEFAULT_MUMBLE_PORT,
      username: getMxIdLocalPart(userId) ?? '',
    }),
    [mumble?.host, mumble?.port, userId]
  );
}

/** The voice settings in effect: what the user saved, over the defaults. */
export function useVoiceSettings(): VoiceSettings {
  const stored = useStoredVoiceSettings();
  const defaults = useVoiceDefaults();
  return useMemo(() => resolveVoiceSettings(stored, defaults), [stored, defaults]);
}
