import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { JumpTo } from './JumpTo';

const openShallowRoute = vi.fn<(path: string) => void>();

vi.mock('$pages/client/useShallowRoute', () => ({
  useOpenShallowRoute: () => openShallowRoute,
}));

vi.mock('$pages/pathUtils', () => ({
  getNavigatePath: () => '/navigate/',
}));

vi.mock('$state/hooks/settings', () => ({
  useSetting: () => [{}, vi.fn<() => void>()],
}));

vi.mock('$state/settings', () => ({
  settingsAtom: {},
}));

vi.mock('$app/keyboard/shortcuts', () => ({
  getShortcutBinding: () => 'mod+k',
  formatShortcut: (binding: string) => binding.replace('mod', 'ctrl'),
}));

describe('JumpTo', () => {
  beforeEach(() => {
    openShallowRoute.mockClear();
  });

  it('shows its label and the room search shortcut', () => {
    render(<JumpTo />);

    expect(screen.getByRole('button', { name: /jump to/i })).toBeInTheDocument();
    expect(screen.getByText('ctrl+k')).toBeInTheDocument();
  });

  it('opens the room search when clicked', () => {
    render(<JumpTo />);

    fireEvent.click(screen.getByRole('button', { name: /jump to/i }));

    expect(openShallowRoute).toHaveBeenCalledTimes(1);
    expect(openShallowRoute).toHaveBeenCalledWith('/navigate/');
  });
});
