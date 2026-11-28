import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MatrixClient } from '$types/matrix-sdk';
import { enableNotifyDevice, verifyNotifyDevice } from './notifyDevice';

const commands = vi.hoisted(() => ({
  kolpakNotifyLogin: vi.fn<(params: Record<string, unknown>) => Promise<string>>(),
  kolpakNotifyLogout: vi.fn<(params: unknown) => Promise<void>>(async () => undefined),
  kolpakNotifyStatus: vi.fn<(params: unknown) => Promise<null>>(async () => null),
}));
vi.mock('$generated/tauri/commands', () => commands);

const USER = '@me:example.org';

function client({
  token,
  devices = [['NOTIFY']],
}: {
  token?: string | Error;
  devices?: string[][];
}) {
  let call = 0;
  const crossSignDevice = vi.fn<(deviceId: string) => Promise<void>>(async () => undefined);
  const getUserDeviceInfo = vi.fn<() => Promise<Map<string, Map<string, object>>>>(async () => {
    const ids = devices[Math.min(call, devices.length - 1)] ?? [];
    call += 1;
    return new Map([[USER, new Map(ids.map((id) => [id, {}]))]]);
  });
  const mx = {
    getUserId: () => USER,
    getHomeserverUrl: () => 'https://hs.example.org',
    requestLoginToken: vi.fn<() => Promise<{ login_token: string }>>(async () => {
      if (token instanceof Error) throw token;
      return { login_token: token ?? 'tok' };
    }),
    getCrypto: () => ({ crossSignDevice, getUserDeviceInfo }),
  } as unknown as MatrixClient;
  return { mx, crossSignDevice, getUserDeviceInfo };
}

describe('notification device', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    commands.kolpakNotifyLogin.mockReset();
    commands.kolpakNotifyLogin.mockResolvedValue('NOTIFY');
  });
  afterEach(() => vi.useRealTimers());

  it('signs in with a login token from this session and verifies the device', async () => {
    const { mx, crossSignDevice } = client({ token: 'abc' });
    const result = await enableNotifyDevice(mx);
    expect(commands.kolpakNotifyLogin).toHaveBeenCalledWith({
      homeserver: 'https://hs.example.org',
      userId: USER,
      password: null,
      loginToken: 'abc',
    });
    expect(result).toEqual({ ok: true, deviceId: 'NOTIFY', verifyError: undefined });
    expect(crossSignDevice).toHaveBeenCalledWith('NOTIFY');
  });

  it('asks for the password when the server gives no login token', async () => {
    const { mx } = client({ token: new Error('M_UNRECOGNIZED') });
    const result = await enableNotifyDevice(mx);
    expect(result).toMatchObject({ ok: false, needsPassword: true });
    expect(commands.kolpakNotifyLogin).not.toHaveBeenCalled();

    const withPassword = await enableNotifyDevice(mx, 'hunter2');
    expect(commands.kolpakNotifyLogin).toHaveBeenCalledWith(
      expect.objectContaining({ password: 'hunter2', loginToken: null })
    );
    expect(withPassword).toMatchObject({ ok: true, deviceId: 'NOTIFY' });
  });

  it('waits for the new device to show up before cross-signing it', async () => {
    const { mx, crossSignDevice, getUserDeviceInfo } = client({ devices: [[], [], ['NOTIFY']] });
    const pending = verifyNotifyDevice(mx, 'NOTIFY');
    await vi.runAllTimersAsync();
    expect(await pending).toBeUndefined();
    expect(getUserDeviceInfo).toHaveBeenCalledTimes(3);
    expect(crossSignDevice).toHaveBeenCalledWith('NOTIFY');
  });
});
