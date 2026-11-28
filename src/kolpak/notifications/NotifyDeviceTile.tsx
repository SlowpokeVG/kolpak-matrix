import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Box, Button, Input, Spinner, Text } from 'folds';
import { SettingTile } from '$components/setting-tile';
import type { NotifyDeviceStatus } from '$generated/tauri/types';
import { useMatrixClient } from '$hooks/useMatrixClient';
import { useSetting } from '$state/hooks/settings';
import { settingsAtom } from '$state/settings';
import { isAndroidTauri } from '$utils/platform';
import {
  disableNotifyDevice,
  enableNotifyDevice,
  notifyDeviceStatus,
  verifyNotifyDevice,
} from './notifyDevice';

// Settings → Notifications, Android only: the notification device (notifyDevice.ts), which
// lets the phone decrypt a message whose room key arrived while the app slept.

const time = (at: number | null | undefined): string =>
  at ? new Date(at).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' }) : 'not yet';

export function NotifyDeviceTile() {
  const mx = useMatrixClient();
  const [backgroundPushEnabled] = useSetting(settingsAtom, 'backgroundPushEnabled');
  const [status, setStatus] = useState<NotifyDeviceStatus | null>();
  const [busy, setBusy] = useState(false);
  const [askPassword, setAskPassword] = useState(false);
  const [password, setPassword] = useState('');
  const [message, setMessage] = useState<string>();
  const show = isAndroidTauri() && backgroundPushEnabled;

  const refresh = useCallback(async () => {
    try {
      setStatus(await notifyDeviceStatus(mx));
    } catch (error) {
      setMessage(String(error));
    }
  }, [mx]);

  useEffect(() => {
    if (show) void refresh();
  }, [show, refresh]);

  if (!show) return null;

  const enable = async (withPassword?: string) => {
    setBusy(true);
    setMessage(undefined);
    const result = await enableNotifyDevice(mx, withPassword);
    if (result.ok) {
      setAskPassword(false);
      setPassword('');
      setMessage(
        result.verifyError
          ? `Signed in, but not verified from this session: ${result.verifyError}`
          : 'Signed in and verified.'
      );
    } else if (result.needsPassword && !withPassword) {
      setAskPassword(true);
      setMessage('Your server wants the account password for this.');
    } else {
      setMessage(`Could not sign in: ${result.error}`);
    }
    setBusy(false);
    await refresh();
  };

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    if (password) void enable(password);
  };

  const disable = async () => {
    const userId = mx.getUserId();
    if (!userId) return;
    setBusy(true);
    try {
      await disableNotifyDevice(userId);
      setMessage('Signed out.');
    } catch (error) {
      setMessage(String(error));
    }
    setBusy(false);
    await refresh();
  };

  const verify = async () => {
    if (!status) return;
    setBusy(true);
    const error = await verifyNotifyDevice(mx, status.deviceId);
    setMessage(error ? `Not verified: ${error}` : 'Verified.');
    setBusy(false);
  };

  const state = status
    ? `On (device ${status.deviceId}). Last key sync: ${time(status.lastSyncAt)}. Keys received: ${status.keysReceived}.${status.lastError ? ` Last error: ${status.lastError}` : ''}`
    : 'Off.';

  return (
    <SettingTile
      title="Notification device"
      focusId="kolpak-notify-device"
      description={
        <Box direction="Column" gap="200">
          <span>
            A second device of your account, “Kolpak notifications”, that the phone runs without the
            app. When a message arrives whose key the phone has not seen (someone started a new
            encryption session while the app slept), it fetches the key and shows the text anyway,
            as Element does. It only receives; it never sends.
          </span>
          <span>{status === undefined ? 'Reading…' : state}</span>
          {message && <span>{message}</span>}
          {askPassword && !status && (
            <Box as="form" onSubmit={onSubmit} gap="200" alignItems="Center" wrap="Wrap">
              <Input
                type="password"
                autoComplete="current-password"
                placeholder="Account password"
                value={password}
                onChange={(event) => setPassword(event.currentTarget.value)}
                size="300"
                variant="Background"
                radii="300"
              />
              <Button
                size="300"
                variant="Primary"
                radii="300"
                type="submit"
                disabled={busy || !password}
              >
                <Text size="B300">Sign in</Text>
              </Button>
            </Box>
          )}
          <Box gap="200" alignItems="Center" wrap="Wrap">
            {!status && !askPassword && (
              <Button
                size="300"
                variant="Secondary"
                fill="Soft"
                radii="300"
                outlined
                disabled={busy}
                onClick={() => void enable()}
              >
                <Text size="B300">Turn on</Text>
              </Button>
            )}
            {status && (
              <>
                <Button
                  size="300"
                  variant="Secondary"
                  fill="Soft"
                  radii="300"
                  outlined
                  disabled={busy}
                  onClick={() => void verify()}
                >
                  <Text size="B300">Verify again</Text>
                </Button>
                <Button
                  size="300"
                  variant="Secondary"
                  fill="Soft"
                  radii="300"
                  outlined
                  disabled={busy}
                  onClick={() => void disable()}
                >
                  <Text size="B300">Turn off</Text>
                </Button>
              </>
            )}
            {busy && <Spinner size="200" variant="Secondary" />}
          </Box>
        </Box>
      }
    />
  );
}
