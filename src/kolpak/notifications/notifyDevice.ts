import {
  kolpakNotifyLogin,
  kolpakNotifyLogout,
  kolpakNotifyStatus,
} from '$generated/tauri/commands';
import type { NotifyDeviceStatus } from '$generated/tauri/types';
import type { MatrixClient } from '$types/matrix-sdk';

// Kolpak, Android: the notification device (src-tauri/src/notify_device.rs). A second
// device of the account that the push service runs natively: senders share room keys with
// it like with any device, and when a push brings a message whose key the phone has not seen,
// the service fetches the key with a short sync and decrypts, without the app (the way
// Element X does it). This file signs it in, verifies it from this session, and signs it out.

export type EnableResult =
  | { ok: true; deviceId: string; verifyError?: string }
  | { ok: false; needsPassword: boolean; error: string };

const describe = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

const sleep = (ms: number) =>
  new Promise<void>((resolve) => {
    window.setTimeout(resolve, ms);
  });

/**
 * Cross-sign the new device from this session so other people's clients and this account's
 * own sessions treat it as verified. Needs this session's cross-signing keys (a verified
 * session). The device list can take a moment to show the new device.
 */
export async function verifyNotifyDevice(
  mx: MatrixClient,
  deviceId: string
): Promise<string | undefined> {
  const crypto = mx.getCrypto();
  const userId = mx.getUserId();
  if (!crypto || !userId) return 'encryption is not ready';
  let lastError = 'the new device did not show up in the device list';
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      // oxlint-disable-next-line no-await-in-loop
      const devices = await crypto.getUserDeviceInfo([userId], true);
      if (devices.get(userId)?.has(deviceId)) {
        // oxlint-disable-next-line no-await-in-loop
        await crypto.crossSignDevice(deviceId);
        return undefined;
      }
    } catch (error) {
      lastError = describe(error);
    }
    // oxlint-disable-next-line no-await-in-loop
    await sleep(1500 * (attempt + 1));
  }
  return lastError;
}

/**
 * Sign the notification device in: with a login token from this session when the server
 * gives one (no password asked), otherwise with the password.
 */
export async function enableNotifyDevice(
  mx: MatrixClient,
  password?: string
): Promise<EnableResult> {
  const userId = mx.getUserId();
  if (!userId) return { ok: false, needsPassword: false, error: 'not signed in' };
  const homeserver = mx.getHomeserverUrl();
  let deviceId: string;
  if (password) {
    try {
      deviceId = await kolpakNotifyLogin({ homeserver, userId, password, loginToken: null });
    } catch (error) {
      return { ok: false, needsPassword: true, error: describe(error) };
    }
  } else {
    try {
      const { login_token: loginToken } = await mx.requestLoginToken();
      deviceId = await kolpakNotifyLogin({ homeserver, userId, password: null, loginToken });
    } catch (error) {
      // The server does not hand out login tokens, or wants the password first.
      return { ok: false, needsPassword: true, error: describe(error) };
    }
  }
  const verifyError = await verifyNotifyDevice(mx, deviceId);
  return { ok: true, deviceId, verifyError };
}

export async function notifyDeviceStatus(mx: MatrixClient): Promise<NotifyDeviceStatus | null> {
  const userId = mx.getUserId();
  if (!userId) return null;
  return kolpakNotifyStatus({ userId });
}

export async function disableNotifyDevice(userId: string): Promise<void> {
  await kolpakNotifyLogout({ userId });
}
