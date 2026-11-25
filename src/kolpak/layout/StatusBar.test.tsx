import { fireEvent, render, screen } from '@testing-library/react';
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
    expect(screen.getByText('24ms')).toBeInTheDocument();
    expect(screen.queryByText('voice --')).not.toBeInTheDocument();
  });

  it('lets a live channel be picked when asked to', () => {
    const onStreamClick = vi.fn<(name: string) => void>();
    render(
      <StatusBar
        streams={[
          { name: 'kino', live: true, viewers: 3 },
          { name: 'nomad', live: false },
        ]}
        onStreamClick={onStreamClick}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: /kino/ }));
    expect(onStreamClick).toHaveBeenCalledWith('kino');
    expect(screen.queryByRole('button', { name: /nomad/ })).not.toBeInTheDocument();
  });

  it('makes the voice entry a button that joins or leaves', () => {
    const onVoiceClick = vi.fn<() => void>();
    const { rerender } = render(<StatusBar onVoiceClick={onVoiceClick} />);

    const join = screen.getByRole('button', { name: 'voice --' });
    expect(join).toHaveAttribute('title', 'join voice');
    fireEvent.click(join);
    expect(onVoiceClick).toHaveBeenCalledTimes(1);

    rerender(
      <StatusBar
        onVoiceClick={onVoiceClick}
        voiceStatus="connected"
        voice={{ channel: 'lobby', users: 2, pingMs: 31 }}
      />
    );
    expect(screen.getByRole('button', { name: 'lobby 2' })).toHaveAttribute('title', 'leave voice');
    expect(screen.getByText('31ms')).toBeInTheDocument();
  });

  it('cannot be clicked while connecting, and shows why voice is down', () => {
    const onVoiceClick = vi.fn<() => void>();
    const { rerender } = render(<StatusBar onVoiceClick={onVoiceClick} voiceStatus="connecting" />);

    expect(screen.getByRole('button', { name: 'voice ...' })).toBeDisabled();

    rerender(<StatusBar onVoiceClick={onVoiceClick} voiceError="the server is full" />);
    expect(screen.getByText('the server is full')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'voice --' })).toBeEnabled();
  });
});
