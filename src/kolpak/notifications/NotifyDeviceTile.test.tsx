import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type * as Platform from '$utils/platform';
import { NotifyDeviceTile } from './NotifyDeviceTile';

const device = vi.hoisted(() => ({
  enableNotifyDevice: vi.fn<(mx: unknown, password?: string) => Promise<unknown>>(),
  disableNotifyDevice: vi.fn<(userId: string) => Promise<void>>(async () => undefined),
  notifyDeviceStatus: vi.fn<() => Promise<unknown>>(async () => null),
  verifyNotifyDevice: vi.fn<() => Promise<undefined>>(async () => undefined),
}));
vi.mock('./notifyDevice', () => device);
vi.mock('$hooks/useMatrixClient', () => ({
  useMatrixClient: () => ({ getUserId: () => '@me:x' }),
}));
vi.mock('$state/hooks/settings', () => ({ useSetting: () => [true, () => undefined] }));
vi.mock('$utils/platform', async (importOriginal) => ({
  ...(await importOriginal<typeof Platform>()),
  isAndroidTauri: () => true,
}));
vi.mock('$components/setting-tile', () => ({
  SettingTile: ({ title, description }: { title: string; description: React.ReactNode }) => (
    <div>
      <h3>{title}</h3>
      {description}
    </div>
  ),
}));

describe('NotifyDeviceTile', () => {
  it('asks for the password when needed and signs in with it', async () => {
    device.enableNotifyDevice
      .mockResolvedValueOnce({ ok: false, needsPassword: true, error: 'no token login' })
      .mockResolvedValueOnce({ ok: true, deviceId: 'NOTIFY' });
    render(<NotifyDeviceTile />);

    fireEvent.click(await screen.findByText('Turn on'));
    const field = await screen.findByPlaceholderText('Password');
    const signIn = screen.getByText('Sign in').closest('button')!;
    expect(signIn.disabled).toBe(true);

    fireEvent.change(field, { target: { value: 'hunter2' } });
    expect(signIn.disabled).toBe(false);
    fireEvent.click(signIn);

    await waitFor(() =>
      expect(device.enableNotifyDevice).toHaveBeenLastCalledWith(expect.anything(), 'hunter2')
    );
    expect(await screen.findByText('Signed in and verified.')).toBeTruthy();
  });

  it('shows why the server refused', async () => {
    device.enableNotifyDevice
      .mockResolvedValueOnce({ ok: false, needsPassword: true, error: 'no token login' })
      .mockResolvedValueOnce({
        ok: false,
        needsPassword: true,
        error: 'login: M_FORBIDDEN: Invalid password',
      });
    render(<NotifyDeviceTile />);
    fireEvent.click(await screen.findByText('Turn on'));
    fireEvent.change(await screen.findByPlaceholderText('Password'), { target: { value: 'nope' } });
    fireEvent.click(screen.getByText('Sign in'));
    expect(await screen.findByText(/Invalid password/)).toBeTruthy();
  });
});
