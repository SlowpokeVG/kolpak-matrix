import { useCallback, useEffect, useState, type ChangeEventHandler } from 'react';
import { Box, Button, Input, Scroll, Text, toRem } from 'folds';
import { PageContent, SettingsSectionPage } from '$components/page';
import { SettingTile, SettingToggle } from '$components/setting-tile';
import { isAndroidTauri } from '$utils/platform';
import { useVoiceDefaults, useVoiceSettings } from './useVoiceSettings';
import {
  formatKeyCode,
  MAX_OUTPUT_VOLUME,
  MAX_VAD_THRESHOLD,
  updateVoiceSettings,
  useStoredVoiceSettings,
  type TransmitMode,
} from './voiceSettings';
import {
  listInputDevices,
  listOutputDevices,
  useVoice,
  watchVoiceLevels,
  type InputDevice,
} from './voiceStore';
import './voice-settings.css';

// Settings → Voice: the Mumble server, the name we join with, the microphone, and how it
// is keyed, including the push-to-talk key.
//
// Both directions work: your microphone is sent and other people are played.

const MODE_LABELS: Record<TransmitMode, string> = {
  ptt: 'Push to talk',
  vad: 'Voice activity',
  continuous: 'Always on',
};

const MODE_ORDER: TransmitMode[] = ['ptt', 'vad', 'continuous'];

// Keys that would lock the user out of ordinary typing or of leaving the capture.
const UNBINDABLE = new Set(['Escape', 'Enter', 'Tab', 'Backspace', 'Delete']);

function PushToTalkKey({ value }: { value: string }) {
  const [capturing, setCapturing] = useState(false);

  useEffect(() => {
    if (!capturing) return undefined;
    const onKeyDown = (event: KeyboardEvent) => {
      event.preventDefault();
      event.stopPropagation();
      if (event.code === 'Escape') {
        setCapturing(false);
        return;
      }
      if (UNBINDABLE.has(event.code) || !event.code) return;
      updateVoiceSettings({ pttKey: event.code });
      setCapturing(false);
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [capturing]);

  return (
    <Box gap="200" alignItems="Center">
      <Button
        size="300"
        variant={capturing ? 'Primary' : 'Secondary'}
        fill={capturing ? 'Solid' : 'Soft'}
        radii="300"
        outlined
        onClick={() => setCapturing((current) => !current)}
        style={{ minWidth: toRem(120) }}
      >
        <Text size="B300">{capturing ? 'Press a key' : formatKeyCode(value)}</Text>
      </Button>
      {value && !capturing && (
        <Button
          size="300"
          variant="Secondary"
          fill="None"
          radii="300"
          onClick={() => updateVoiceSettings({ pttKey: '' })}
        >
          <Text size="B300">Clear</Text>
        </Button>
      )}
    </Box>
  );
}

type DeviceSelectProps = {
  kind: 'input' | 'output';
  value: string;
  onChange: (id: string) => void;
};

function DeviceSelect({ kind, value, onChange }: DeviceSelectProps) {
  const [devices, setDevices] = useState<InputDevice[]>([]);

  useEffect(() => {
    let current = true;
    void (kind === 'input' ? listInputDevices() : listOutputDevices()).then((list) => {
      if (current) setDevices(list);
    });
    return () => {
      current = false;
    };
  }, [kind]);

  const known = value === '' || devices.some((device) => device.id === value);

  return (
    <select
      className="kolpak-select"
      aria-label={kind === 'input' ? 'Microphone' : 'Speakers'}
      value={value}
      onChange={(event) => onChange(event.target.value)}
    >
      <option value="">System default</option>
      {devices.map((device) => (
        <option key={device.id} value={device.id}>
          {device.name}
          {device.isDefault ? ' (default)' : ''}
        </option>
      ))}
      {!known && <option value={value}>Saved device (not connected)</option>}
    </select>
  );
}

const meterScale = (level: number): string =>
  `${Math.min(100, (level / MAX_VAD_THRESHOLD) * 100)}%`;

// The meter and the threshold share one scale, so the marker shows where speech has to
// reach for voice activity to open the microphone.
type LevelMeterProps = {
  label: string;
  level: number;
  active?: boolean;
  threshold?: number;
};

function LevelMeter({ label, level, active, threshold }: LevelMeterProps) {
  return (
    <div
      className="kolpak-meter"
      data-transmitting={active ? 'true' : undefined}
      role="meter"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(Math.min(1, level / MAX_VAD_THRESHOLD) * 100)}
    >
      <div className="kolpak-meter__fill" style={{ width: meterScale(level) }} />
      {threshold !== undefined && (
        <div className="kolpak-meter__mark" style={{ left: meterScale(threshold) }} />
      )}
    </div>
  );
}

type VoiceSettingsPageProps = {
  requestBack?: () => void;
  requestClose: () => void;
};

export function VoiceSettingsPage({ requestBack, requestClose }: VoiceSettingsPageProps) {
  const stored = useStoredVoiceSettings();
  const defaults = useVoiceDefaults();
  const settings = useVoiceSettings();
  const voice = useVoice();
  // The meters below: levels come from the native side only while this page is open.
  useEffect(() => watchVoiceLevels(), []);
  const connected = voice.status === 'connected';
  // Android routes voice itself and has no keyboard to hold: no device pickers, no
  // push-to-talk key (the live sheet has a button to hold instead), and a call/media switch.
  const android = isAndroidTauri();

  const onHost = useCallback<ChangeEventHandler<HTMLInputElement>>(
    (event) => updateVoiceSettings({ host: event.target.value }),
    []
  );
  const onUsername = useCallback<ChangeEventHandler<HTMLInputElement>>(
    (event) => updateVoiceSettings({ username: event.target.value }),
    []
  );
  const onPort = useCallback<ChangeEventHandler<HTMLInputElement>>(
    (event) => {
      const port = Number.parseInt(event.target.value, 10);
      updateVoiceSettings({ port: Number.isNaN(port) ? defaults.port : port });
    },
    [defaults.port]
  );

  return (
    <SettingsSectionPage title="Voice" requestBack={requestBack} requestClose={requestClose}>
      <Box grow="Yes">
        <Scroll hideTrack visibility="Hover">
          <PageContent>
            <Box direction="Column" gap="700">
              <Box direction="Column" gap="100">
                <Text size="L400">Mumble server</Text>
                <SettingTile
                  title="Server"
                  description="Host name of the Mumble server. Leave empty to use the community server."
                  after={
                    <Input
                      style={{ width: toRem(220) }}
                      variant="Secondary"
                      size="300"
                      radii="300"
                      outlined
                      autoComplete="off"
                      spellCheck={false}
                      aria-label="Mumble server host"
                      placeholder={defaults.host}
                      value={stored.host ?? ''}
                      onChange={onHost}
                    />
                  }
                />
                <SettingTile
                  title="Port"
                  after={
                    <Input
                      style={{ width: toRem(100) }}
                      variant="Secondary"
                      size="300"
                      radii="300"
                      outlined
                      type="number"
                      min="1"
                      max="65535"
                      aria-label="Mumble server port"
                      value={String(settings.port)}
                      onChange={onPort}
                    />
                  }
                />
                <SettingTile
                  title="Name"
                  description="The name others see in voice. Leave empty to use your Matrix name."
                  after={
                    <Input
                      style={{ width: toRem(220) }}
                      variant="Secondary"
                      size="300"
                      radii="300"
                      outlined
                      autoComplete="off"
                      spellCheck={false}
                      aria-label="Mumble user name"
                      placeholder={defaults.username}
                      value={stored.username ?? ''}
                      onChange={onUsername}
                    />
                  }
                />
                {connected && (
                  <SettingTile
                    title="Voice path"
                    description={
                      voice.udp
                        ? 'UDP: the direct, low-delay path.'
                        : 'Through the control connection. Slower; used while UDP is blocked or still being checked.'
                    }
                  />
                )}
                <SettingToggle
                  title="Join voice on startup"
                  description="Connect to the server when Kolpak starts."
                  value={settings.autoConnect}
                  onChange={(autoConnect) => updateVoiceSettings({ autoConnect })}
                  focusId="join-voice-on-startup"
                  ariaLabel="join-voice-on-startup"
                />
              </Box>

              <Box direction="Column" gap="100">
                <Text size="L400">Speakers</Text>
                {android && (
                  <SettingToggle
                    title="Call audio"
                    focusId="voice-call-audio"
                    description={
                      settings.callAudio
                        ? "Voice works like a phone call: your phone's echo cancellation is on, and sound goes to a Bluetooth or wired headset when one is connected, otherwise to the loudspeaker."
                        : 'Voice plays as media: no echo cancellation (use headphones), and Bluetooth headphones keep their high-quality link.'
                    }
                    value={settings.callAudio}
                    onChange={(callAudio) => updateVoiceSettings({ callAudio })}
                    ariaLabel="voice-call-audio"
                  />
                )}
                <SettingTile
                  title="Output"
                  description={
                    voice.outputError ??
                    (voice.outputDevice
                      ? `In use: ${voice.outputDevice}`
                      : 'Used when you join voice.')
                  }
                  after={
                    android ? undefined : (
                      <DeviceSelect
                        kind="output"
                        value={settings.outputDevice}
                        onChange={(outputDevice) => updateVoiceSettings({ outputDevice })}
                      />
                    )
                  }
                />
                <SettingTile
                  title="Volume"
                  description={`${Math.round(settings.outputVolume * 100)}%. Above 100% boosts quiet voices.`}
                  after={
                    <input
                      className="kolpak-range"
                      type="range"
                      aria-label="Voice volume"
                      min={0}
                      max={MAX_OUTPUT_VOLUME}
                      step={0.05}
                      value={settings.outputVolume}
                      onChange={(event) =>
                        updateVoiceSettings({ outputVolume: Number(event.target.value) })
                      }
                    />
                  }
                />
                <SettingTile
                  title="Output level"
                  description={
                    connected
                      ? 'Moves when someone in your channel speaks.'
                      : 'Join voice to hear others.'
                  }
                  after={
                    <LevelMeter
                      label="Voice output level"
                      level={voice.outputLevel}
                      active={voice.talking.length > 0}
                    />
                  }
                />
              </Box>

              <Box direction="Column" gap="100">
                <Text size="L400">Microphone</Text>
                <SettingTile
                  title="Microphone"
                  description={
                    (voice.microphoneDenied
                      ? 'Kolpak may not use the microphone, so you are listening only. Allow it in Android settings → Apps → Kolpak → Permissions, then join again.'
                      : undefined) ??
                    voice.captureError ??
                    (voice.captureDevice
                      ? `In use: ${voice.captureDevice}`
                      : 'Used when you join voice.')
                  }
                  after={
                    android ? undefined : (
                      <DeviceSelect
                        kind="input"
                        value={settings.inputDevice}
                        onChange={(inputDevice) => updateVoiceSettings({ inputDevice })}
                      />
                    )
                  }
                />
                <SettingTile
                  title="Input level"
                  description={
                    connected
                      ? 'Speak to see your level. The bar turns green while you are being sent.'
                      : 'Join voice to see your level.'
                  }
                  after={
                    <LevelMeter
                      label="Microphone level"
                      level={voice.inputLevel}
                      active={voice.transmitting}
                      threshold={
                        settings.transmitMode === 'vad' ? settings.vadThreshold : undefined
                      }
                    />
                  }
                />
                <SettingToggle
                  title="Noise suppression"
                  focusId="voice-noise-suppression"
                  description="Removes steady background noise such as fans and hiss from your microphone."
                  value={settings.noiseSuppression}
                  onChange={(noiseSuppression) => updateVoiceSettings({ noiseSuppression })}
                  ariaLabel="voice-noise-suppression"
                />
                <SettingTile
                  title="Transmit"
                  description="When your microphone is sent to the channel."
                  after={
                    <Box gap="100">
                      {MODE_ORDER.map((mode) => (
                        <Button
                          key={mode}
                          size="300"
                          radii="300"
                          variant="Secondary"
                          fill={settings.transmitMode === mode ? 'Solid' : 'Soft'}
                          aria-pressed={settings.transmitMode === mode}
                          onClick={() => updateVoiceSettings({ transmitMode: mode })}
                        >
                          <Text size="B300">{MODE_LABELS[mode]}</Text>
                        </Button>
                      ))}
                    </Box>
                  }
                />
                {settings.transmitMode === 'vad' && (
                  <SettingTile
                    title="Voice activity threshold"
                    description="How loud you have to be before the microphone opens. Set it just above your room noise."
                    after={
                      <input
                        className="kolpak-range"
                        type="range"
                        aria-label="Voice activity threshold"
                        min={0}
                        max={MAX_VAD_THRESHOLD}
                        step={0.002}
                        value={Math.min(settings.vadThreshold, MAX_VAD_THRESHOLD)}
                        onChange={(event) =>
                          updateVoiceSettings({ vadThreshold: Number(event.target.value) })
                        }
                      />
                    }
                  />
                )}
                {android ? (
                  settings.transmitMode === 'ptt' && (
                    <SettingTile
                      title="Push to talk"
                      description="Hold the TALK button in the live panel (tap the bar at the bottom of the screen) or on the bar itself."
                    />
                  )
                ) : (
                  <SettingTile
                    title="Push-to-talk key"
                    description={
                      settings.transmitMode === 'ptt'
                        ? 'Hold this key to talk. On Windows it works from any app; elsewhere only while Kolpak has focus. Click the button, then press the key. Escape cancels.'
                        : 'Used when Transmit is set to Push to talk.'
                    }
                    after={<PushToTalkKey value={settings.pttKey} />}
                  />
                )}
              </Box>
            </Box>
          </PageContent>
        </Scroll>
      </Box>
    </SettingsSectionPage>
  );
}
