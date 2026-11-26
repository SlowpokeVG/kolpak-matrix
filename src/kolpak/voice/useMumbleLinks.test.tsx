import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useMumbleLinks } from './useMumbleLinks';
import type { MumbleTarget } from './mumbleLinks';

const joinMumbleLink = vi.fn<(target: MumbleTarget, username: string) => Promise<boolean>>();
const setDockOpen = vi.fn<(open: boolean) => void>();

vi.mock('./platform', () => ({ voiceSupported: () => true }));
vi.mock('./voiceStore', () => ({
  joinMumbleLink: (target: MumbleTarget, username: string) => joinMumbleLink(target, username),
}));
vi.mock('../layout/dockStore', () => ({ setDockOpen: (open: boolean) => setDockOpen(open) }));
vi.mock('../mobile/liveSheetStore', () => ({ setLiveSheetOpen: vi.fn<() => void>() }));
vi.mock('$utils/platform', () => ({ isMobileTauri: () => false }));

function Message() {
  useMumbleLinks('pyro');
  return (
    <p>
      <a href="https://matrix-memes.klpq.io/join-mumble.html#mumble%3A%2F%2Fmumble.klpq.io%3A64738">
        join
      </a>
      <a href="https://example.org/page">other</a>
    </p>
  );
}

describe('useMumbleLinks', () => {
  beforeEach(() => {
    joinMumbleLink.mockReset().mockResolvedValue(true);
    setDockOpen.mockReset();
  });

  it("joins the bot's link with Kolpak voice instead of following it", () => {
    render(<Message />);
    const click = new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 });
    screen.getByText('join').dispatchEvent(click);
    expect(click.defaultPrevented).toBe(true);
    expect(joinMumbleLink).toHaveBeenCalledWith(
      { host: 'mumble.klpq.io', port: 64738, channelPath: [] },
      'pyro'
    );
    expect(setDockOpen).toHaveBeenCalledWith(true);
  });

  it('leaves other links and modified clicks alone', () => {
    render(<Message />);
    fireEvent.click(screen.getByText('other'));
    fireEvent.click(screen.getByText('join'), { ctrlKey: true });
    expect(joinMumbleLink).not.toHaveBeenCalled();
  });
});
