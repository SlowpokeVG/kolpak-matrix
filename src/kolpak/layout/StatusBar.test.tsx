import { render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { StatusBar } from './StatusBar';

describe('StatusBar', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 10, 25, 9, 5, 30));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('shows a 24-hour clock and placeholders when no service is connected', () => {
    render(<StatusBar />);

    expect(screen.getByText('09:05')).toBeInTheDocument();
    expect(screen.getByText('streams --')).toBeInTheDocument();
    expect(screen.getByText('voice --')).toBeInTheDocument();
  });

  it('lists live channels with viewers and offline channels as "name --"', () => {
    render(
      <StatusBar
        streams={[
          { name: 'kino', live: true, viewers: 12 },
          { name: 'nomad', live: false },
        ]}
      />
    );

    expect(screen.getByText('kino')).toBeInTheDocument();
    expect(screen.getByText('12')).toBeInTheDocument();
    expect(screen.getByText('nomad --')).toBeInTheDocument();
    expect(screen.queryByText('streams --')).not.toBeInTheDocument();
  });

  it('shows the voice channel, its user count and latency', () => {
    render(<StatusBar voice={{ channel: 'lobby', users: 3, pingMs: 24 }} />);

    expect(screen.getByText('lobby 3')).toBeInTheDocument();
    expect(screen.getByText('24 ms')).toBeInTheDocument();
    expect(screen.queryByText('voice --')).not.toBeInTheDocument();
  });
});
