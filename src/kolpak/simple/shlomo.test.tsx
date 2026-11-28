import { act, render } from '@testing-library/react';
import { createStore, Provider } from 'jotai';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ScreenSize } from '$hooks/useScreenSize';
import { MessageLayout } from '$state/settings';

// Shlomo mode: the look's Sable settings follow the switches, the mode starts on, and the
// phone's tab bar shows on the tab pages only. Every module is imported afresh per test
// (the mode reads its storage once, on import), the atoms and contexts along with it.

beforeEach(() => {
  localStorage.clear();
  vi.resetModules();
});

afterEach(() => {
  localStorage.clear();
});

const modernStore = async () => {
  const { getSettings, settingsAtom } = await import('$state/settings');
  const store = createStore();
  store.set(settingsAtom, {
    ...getSettings(),
    messageLayout: MessageLayout.Modern,
    useRightBubbles: false,
    hideMembershipEvents: false,
    hideNickAvatarEvents: false,
  });
  return { store, settingsAtom };
};

describe('ShlomoLookSync', () => {
  it('applies the look on a fresh install and puts the settings back when it is off', async () => {
    const { ShlomoLookSync } = await import('./ShlomoLookSync');
    const mode = await import('./simpleMode');
    const { store, settingsAtom } = await modernStore();
    render(
      <Provider store={store}>
        <ShlomoLookSync />
      </Provider>
    );

    expect(mode.getSimpleMode().enabled).toBe(true);
    expect(store.get(settingsAtom).messageLayout).toBe(MessageLayout.Bubble);
    expect(store.get(settingsAtom).useRightBubbles).toBe(true);
    expect(store.get(settingsAtom).hideMembershipEvents).toBe(true);
    expect(mode.getSimpleMode().before?.messageLayout).toBe(MessageLayout.Modern);
    expect(document.documentElement.classList.contains('kolpak-simple')).toBe(true);

    act(() => mode.setShlomoPart('look', false));
    expect(store.get(settingsAtom).messageLayout).toBe(MessageLayout.Modern);
    expect(store.get(settingsAtom).useRightBubbles).toBe(false);
    expect(store.get(settingsAtom).hideMembershipEvents).toBe(false);
    expect(mode.getSimpleMode().before).toBeUndefined();
    expect(document.documentElement.classList.contains('kolpak-simple')).toBe(false);
    // The room rows are a part of their own.
    expect(document.documentElement.classList.contains('kolpak-simple-rows')).toBe(true);

    // The master switch takes the look along with it.
    act(() => mode.setShlomoPart('look', true));
    expect(store.get(settingsAtom).messageLayout).toBe(MessageLayout.Bubble);
    act(() => mode.updateSimpleMode({ enabled: false }));
    expect(store.get(settingsAtom).messageLayout).toBe(MessageLayout.Modern);
    expect(document.documentElement.classList.contains('kolpak-simple-rows')).toBe(false);
  });

  it('leaves the settings alone for someone who switched the mode off', async () => {
    localStorage.setItem('kolpak:simple', JSON.stringify({ enabled: false }));
    const { ShlomoLookSync } = await import('./ShlomoLookSync');
    const { store, settingsAtom } = await modernStore();
    render(
      <Provider store={store}>
        <ShlomoLookSync />
      </Provider>
    );
    expect(store.get(settingsAtom).messageLayout).toBe(MessageLayout.Modern);
  });
});

describe('MobileFriendlyBottomNav', () => {
  const shown = async (path: string, size = ScreenSize.Mobile) => {
    const { MobileFriendlyBottomNav } = await import('$pages/MobileFriendly');
    const { ScreenSizeProvider } = await import('$hooks/useScreenSize');
    const { container, unmount } = render(
      <ScreenSizeProvider value={size}>
        <MemoryRouter initialEntries={[path]}>
          <MobileFriendlyBottomNav>
            <span data-testid="bar" />
          </MobileFriendlyBottomNav>
        </MemoryRouter>
      </ScreenSizeProvider>
    );
    const result = container.querySelector('[data-testid="bar"]') !== null;
    unmount();
    return result;
  };

  it('is on every tab page of a phone, room lists included', async () => {
    expect(await shown('/home/')).toBe(true);
    expect(await shown('/direct/')).toBe(true);
    expect(await shown('/!space:x/')).toBe(true);
    expect(await shown('/inbox/notifications/')).toBe(true);
    expect(await shown('/profile/')).toBe(true);
  });

  it('is not in a room, on other pages, or off a phone', async () => {
    expect(await shown('/home/!room:x/')).toBe(false);
    expect(await shown('/!space:x/!room:x/')).toBe(false);
    expect(await shown('/explore/')).toBe(false);
    expect(await shown('/create-room')).toBe(false);
    expect(await shown('/settings/')).toBe(false);
    expect(await shown('/home/', ScreenSize.Desktop)).toBe(false);
  });
});
