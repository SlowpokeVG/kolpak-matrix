import { useCallback, useEffect, useState } from 'react';
import { Box, Button, Spinner, Text } from 'folds';
import { SettingTile } from '$components/setting-tile';
import { kolpakPushKeysStatus } from '$generated/tauri/commands';
import type { PushKeysStatus } from '$generated/tauri/types';
import { useMatrixClient } from '$hooks/useMatrixClient';
import { useSetting } from '$state/hooks/settings';
import { settingsAtom } from '$state/settings';
import { isAndroidTauri } from '$utils/platform';
import {
  checkPushDecryption,
  copyPushKeysNow,
  onPushKeysCopied,
  type PushCheck,
} from './pushKeyMirror';

// Settings → Notifications, Android only: how the native push path's copy of the room keys
// is doing (pushKeyMirror.ts, src-tauri/src/push_keys.rs). Shows what the last copy and the
// last push did, copies on demand, and decrypts the newest encrypted message the way a push
// is decrypted, so a broken link in the chain shows up with its error.

const time = (at: number | undefined): string =>
  at ? new Date(at).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' }) : '';

function describe(status: PushKeysStatus | undefined, error: string | undefined): string {
  if (error) return `Could not read the state: ${error}`;
  if (!status) return 'Reading…';
  const lines = [`Room keys copied for notifications: ${status.sessions}.`];
  const copy = status.lastCopy;
  if (copy?.error) lines.push(`Last copy failed ${time(copy.at)}: ${copy.error}`);
  else if (copy) lines.push(`Last copy ${time(copy.at)}: ${copy.added} new, ${copy.ms} ms.`);
  else lines.push('Nothing copied yet.');
  const push = status.lastPush;
  if (push?.ok) lines.push(`Last notification decrypted ${time(push.at)}.`);
  else if (push) lines.push(`Last notification not decrypted ${time(push.at)}: ${push.error}`);
  return lines.join(' ');
}

export function PushKeysTile() {
  const mx = useMatrixClient();
  const [backgroundPushEnabled] = useSetting(settingsAtom, 'backgroundPushEnabled');
  const [status, setStatus] = useState<PushKeysStatus>();
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState<'copy' | 'check'>();
  const [check, setCheck] = useState<PushCheck>();
  const show = isAndroidTauri() && backgroundPushEnabled;

  const refresh = useCallback(async () => {
    const userId = mx.getUserId();
    const deviceId = mx.getDeviceId();
    if (!userId || !deviceId) return;
    try {
      setStatus(await kolpakPushKeysStatus({ userId, deviceId }));
      setError(undefined);
    } catch (err) {
      setError(String(err));
    }
  }, [mx]);

  useEffect(() => {
    if (!show) return undefined;
    void refresh();
    return onPushKeysCopied(() => void refresh());
  }, [show, refresh]);

  if (!show) return null;

  const copyNow = async () => {
    setBusy('copy');
    try {
      await copyPushKeysNow();
    } catch (err) {
      setError(String(err));
    }
    setBusy(undefined);
    await refresh();
  };

  const runCheck = async () => {
    setBusy('check');
    setCheck(undefined);
    try {
      setCheck(await checkPushDecryption(mx));
    } catch (err) {
      setCheck({ ok: false, detail: String(err) });
    }
    setBusy(undefined);
    await refresh();
  };

  return (
    <SettingTile
      title="Message text in notifications"
      focusId="kolpak-push-keys"
      description={
        <Box direction="Column" gap="200">
          <span>{describe(status, error)}</span>
          {check && (
            <span>
              {check.ok ? 'Check passed: ' : 'Check failed: '}
              {check.detail}
            </span>
          )}
          <Box gap="200" alignItems="Center" wrap="Wrap">
            <Button
              size="300"
              variant="Secondary"
              fill="Soft"
              radii="300"
              outlined
              disabled={!!busy}
              onClick={() => void copyNow()}
            >
              <Text size="B300">Copy now</Text>
            </Button>
            <Button
              size="300"
              variant="Secondary"
              fill="Soft"
              radii="300"
              outlined
              disabled={!!busy}
              onClick={() => void runCheck()}
            >
              <Text size="B300">Check</Text>
            </Button>
            {busy && <Spinner size="200" variant="Secondary" />}
          </Box>
        </Box>
      }
    />
  );
}
