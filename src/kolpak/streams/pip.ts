import { useSyncExternalStore } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { isAndroidTauri } from '$utils/platform';
import { activeVideo, stopStream } from './sharedPlayer';

// Picture in picture for the stream.
//
// - Desktop and browsers: the standard API on the <video> (WebView2, CEF and WKWebView have
//   it; WebKitGTK does not, so there is no button there).
// - Android: the system WebView has no such API, so the whole app goes into Android's
//   picture-in-picture window (MainActivity.enterPipNative) and the page shows only the
//   video (PipStage). The stage goes up the moment PIP is pressed, so the window animates
//   into the video rather than into the page; it comes down when Android reports the window
//   expanded or closed, or if Android never entered it. Closing the window stops the stream.

/** How long to wait for Android to report the window before taking the stage down again. */
const ENTER_TIMEOUT_MS = 2500;

let stage = false;
let active = false;
let enterTimer: number | undefined;
const listeners = new Set<() => void>();
let bridge: Promise<unknown> | undefined;

const setStage = (next: boolean): void => {
  if (stage === next) return;
  stage = next;
  listeners.forEach((listener) => listener());
};

const startBridge = (): void => {
  if (bridge || !isAndroidTauri()) return;
  bridge = listen<{ active: boolean; dismissed: boolean }>('kolpak://pip', (event) => {
    active = event.payload.active;
    window.clearTimeout(enterTimer);
    setStage(active);
    if (event.payload.dismissed) stopStream();
  }).catch(() => undefined);
};

export function pipSupported(): boolean {
  if (isAndroidTauri()) return true;
  return typeof document !== 'undefined' && document.pictureInPictureEnabled;
}

/** Open the playing stream in picture in picture. Does nothing when nothing plays. */
export async function enterPip(): Promise<void> {
  const video = activeVideo();
  if (!video) return;
  if (isAndroidTauri()) {
    startBridge();
    setStage(true);
    window.clearTimeout(enterTimer);
    enterTimer = window.setTimeout(() => {
      if (!active) setStage(false);
    }, ENTER_TIMEOUT_MS);
    await invoke('kolpak_enter_pip', {
      width: video.videoWidth || 16,
      height: video.videoHeight || 9,
    }).catch(() => {
      window.clearTimeout(enterTimer);
      setStage(false);
    });
    return;
  }
  if (document.pictureInPictureElement === video) {
    await document.exitPictureInPicture().catch(() => undefined);
    return;
  }
  await video.requestPictureInPicture().catch(() => undefined);
}

const subscribe = (listener: () => void): (() => void) => {
  startBridge();
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

const getStage = (): boolean => stage;

/** Android: whether the page should show only the video (picture in picture). */
export function useAndroidPipStage(): boolean {
  return useSyncExternalStore(subscribe, getStage);
}
