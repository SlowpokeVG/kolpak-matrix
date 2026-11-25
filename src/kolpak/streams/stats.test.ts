import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  fetchChannelNames,
  fetchChannelStreams,
  orderChannels,
  toChannelStatus,
  type StatsStream,
} from './stats';

const stream = (overrides: Partial<StatsStream> = {}): StatsStream => ({
  app: 'live',
  protocol: 'flv',
  viewers: 0,
  ...overrides,
});

const jsonResponse = (body: unknown, ok = true, status = 200) =>
  ({ ok, status, json: async () => body }) as Response;

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('toChannelStatus', () => {
  it('is off air with no streams', () => {
    expect(toChannelStatus('kino', [])).toEqual({ name: 'kino', live: false, viewers: 0 });
  });

  it('is live and sums viewers over every stream of the channel', () => {
    const streams = [stream({ protocol: 'rtmp', viewers: 2 }), stream({ viewers: 5 }), stream({})];
    expect(toChannelStatus('stream', streams)).toEqual({ name: 'stream', live: true, viewers: 7 });
  });
});

describe('orderChannels', () => {
  it('puts live channels first, busiest first, then the rest by name', () => {
    const ordered = orderChannels([
      { name: 'rebel', live: false, viewers: 0 },
      { name: 'pyro', live: true, viewers: 3 },
      { name: 'kino', live: false, viewers: 0 },
      { name: 'stream', live: true, viewers: 12 },
    ]);
    expect(ordered.map((channel) => channel.name)).toEqual(['stream', 'pyro', 'kino', 'rebel']);
  });
});

describe('fetchChannelNames', () => {
  it('reads the channel list from the history endpoint', async () => {
    const fetchMock = vi.fn<typeof fetch>(async () =>
      jsonResponse({ options: { channels: ['kino', 7, 'stream'] }, total: 3 })
    );
    vi.stubGlobal('fetch', fetchMock);

    await expect(fetchChannelNames('https://stats.example/v1/')).resolves.toEqual([
      'kino',
      'stream',
    ]);
    expect(fetchMock.mock.calls[0]?.[0]).toBe('https://stats.example/v1/streams?limit=1');
  });

  it('throws when the service answers with an error', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>(async () => jsonResponse({}, false, 503))
    );

    await expect(fetchChannelNames('https://stats.example/v1')).rejects.toThrow('503');
  });
});

describe('fetchChannelStreams', () => {
  it('asks for one channel and returns its streams', async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => jsonResponse({ streams: [stream()] }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(fetchChannelStreams('https://stats.example/v1', 'my room')).resolves.toHaveLength(
      1
    );
    expect(fetchMock.mock.calls[0]?.[0]).toBe('https://stats.example/v1/channels/my%20room');
  });

  it('treats a missing list as off air', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>(async () => jsonResponse({}))
    );

    await expect(fetchChannelStreams('https://stats.example/v1', 'kino')).resolves.toEqual([]);
  });
});
