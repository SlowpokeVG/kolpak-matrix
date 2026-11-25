import { afterEach, describe, expect, it } from 'vitest';
import { imagesFrom, isPostableImage } from './chatImages';
import { clock, stripReplyFallback } from './TheaterChat';
import { closeTheater, openTheater, setTheaterRoom, useTheater } from './theaterStore';
import { renderHook, act } from '@testing-library/react';

describe('theater store', () => {
  afterEach(() => {
    act(() => closeTheater());
  });

  it('opens, remembers a chosen room, and forgets it on close', () => {
    const { result } = renderHook(() => useTheater());
    expect(result.current).toEqual({ open: false, roomId: null });

    act(() => openTheater());
    expect(result.current.open).toBe(true);

    act(() => setTheaterRoom('!chat:example.org'));
    expect(result.current).toEqual({ open: true, roomId: '!chat:example.org' });

    act(() => closeTheater());
    expect(result.current).toEqual({ open: false, roomId: null });
  });
});

describe('compact chat lines', () => {
  it('shows times as 24-hour HH:MM', () => {
    expect(clock(new Date(2026, 10, 25, 3, 7).getTime())).toBe('03:07');
    expect(clock(new Date(2026, 10, 25, 17, 24).getTime())).toBe('17:24');
  });

  it('drops the quoted fallback at the top of a reply', () => {
    expect(stripReplyFallback('> <@a:example.org> earlier\n> more\n\nmy answer')).toBe('my answer');
    expect(stripReplyFallback('plain message')).toBe('plain message');
    expect(stripReplyFallback('not > a quote')).toBe('not > a quote');
  });
});

describe('images from a paste or a drop', () => {
  const transfer = (files: File[]) => ({ files }) as unknown as DataTransfer;

  it('keeps only images', () => {
    const png = new File(['x'], 'shot.png', { type: 'image/png' });
    const gif = new File(['x'], 'loop.gif', { type: 'image/gif' });
    const text = new File(['x'], 'notes.txt', { type: 'text/plain' });
    expect(imagesFrom(transfer([png, text, gif]))).toEqual([png, gif]);
    expect(imagesFrom(transfer([text]))).toEqual([]);
    expect(imagesFrom(null)).toEqual([]);
    expect(isPostableImage(text)).toBe(false);
  });
});
