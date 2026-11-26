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
//   picture-in-picture window (MainActivity.enterPipNative) and, while it is there, the page
//   shows only the video (PipStage). Closing the window stops the stream; expanding it brings
//   the app back as it was.

let androidActive = false;
const listeners = new Set<() => void>();
let bridge: Promise<unknown> | undefined;

const startBridge = (): void => {
  if (bridge || !isAndroidTauri()) return;
  bridge = listen<{ active: boolean; dismissed: boolean }>('kolpak://pip', (event) => {
    androidActive = event.payload.active;
    if (event.payload.dismissed) stopStream();
    listeners.forEach((listener) => listener());
  }).catch(() => undefined);
};

export function pipSupported(): boolean {
  if (isAndroidTauri()) return true;
  return typeof document !== 'undefined' && Boolean(document.pictureInPictureEnabled);
}

/** Open the playing stream in picture in picture. Does nothing when nothing plays. */
export async function enterPip(): Promise<void> {
  const video = activeVideo();
  if (!video) return;
  if (isAndroidTauri()) {
    startBridge();
    await invoke('kolpak_enter_pip', {
      width: video.videoWidth || 16,
      height: video.videoHeight || 9,
    }).catch(() => undefined);
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

const getActive = (): boolean => androidActive;

/** Android: whether the app is in the picture-in-picture window right now. */
export function useAndroidPip(): boolean {
  return useSyncExternalStore(subscribe, getActive);
}
