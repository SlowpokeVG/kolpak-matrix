import { useEffect, useSyncExternalStore, type RefObject } from 'react';
import { attachStream } from './player';
import type { StreamSource } from './stats';
import { readStreamVolume, saveStreamVolume } from './streamStore';

// One player for the whole app (AI/SPEC.md §6): a single <video> that is moved between the
// dock and theater mode instead of being reloaded. Whichever view is on screen hosts it;
// when no view hosts it any more, playback stops.

export type PlayerStatus = 'idle' | 'loading' | 'playing' | 'error';

export type PlayerSnapshot = {
  status: PlayerStatus;
  /** Which source is loaded, as `protocol url`; null while idle. */
  sourceKey: string | null;
};

export const sourceKeyOf = (source: StreamSource): string => `${source.protocol} ${source.url}`;

let video: HTMLVideoElement | undefined;
let snapshot: PlayerSnapshot = { status: 'idle', sourceKey: null };
let stop: (() => void) | undefined;
let generation = 0;
const listeners = new Set<() => void>();

const set = (patch: Partial<PlayerSnapshot>): void => {
  snapshot = { ...snapshot, ...patch };
  listeners.forEach((listener) => listener());
};

function element(): HTMLVideoElement {
  if (!video) {
    const created = document.createElement('video');
    created.className = 'kolpak-stream__video';
    created.playsInline = true;
    created.addEventListener('playing', () => {
      if (snapshot.sourceKey) set({ status: 'playing' });
      created.controls = true;
    });
    created.addEventListener('volumechange', () => {
      if (!created.muted) saveStreamVolume(created.volume);
    });
    video = created;
  }
  return video;
}

export function playStream(source: StreamSource): void {
  const key = sourceKeyOf(source);
  if (snapshot.sourceKey === key && snapshot.status !== 'error') return;
  stopStream();
  const target = element();
  const current = ++generation;
  target.volume = readStreamVolume();
  set({ status: 'loading', sourceKey: key });
  attachStream(target, source, () => {
    if (current === generation) set({ status: 'error' });
  })
    .then((made) => {
      if (current === generation) stop = made;
      else made();
    })
    .catch(() => {
      if (current === generation) set({ status: 'error' });
    });
}

export function stopStream(): void {
  generation += 1;
  stop?.();
  stop = undefined;
  if (video) video.controls = false;
  if (snapshot.status !== 'idle' || snapshot.sourceKey !== null) {
    set({ status: 'idle', sourceKey: null });
  }
}

const subscribe = (listener: () => void): (() => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

const getSnapshot = (): PlayerSnapshot => snapshot;

export function usePlayer(): PlayerSnapshot {
  return useSyncExternalStore(subscribe, getSnapshot);
}

/**
 * Put the shared video inside `host` while the calling component is mounted. When a view
 * unmounts and no other view has taken the video by the end of the same update, playback
 * stops: closing the dock stops the stream, switching dock and theater does not.
 */
export function usePlayerHost(host: RefObject<HTMLElement | null>): void {
  useEffect(() => {
    const container = host.current;
    if (!container) return undefined;
    container.appendChild(element());
    return () => {
      queueMicrotask(() => {
        if (video && !video.isConnected) stopStream();
      });
    };
  }, [host]);
}
