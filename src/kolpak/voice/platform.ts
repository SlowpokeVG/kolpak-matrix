import { isAndroidTauri, isDesktopTauri } from '$utils/platform';

// Where Mumble voice runs: the desktop app and the Android app. Both carry the native
// bridge (src-tauri/src/mumble.rs); the web build and iOS do not.

export function voiceSupported(): boolean {
  return isDesktopTauri() || isAndroidTauri();
}

/**
 * Android only: ask for the microphone before joining. The native side cannot ask, so the
 * webview does, which shows Android's own permission prompt. Resolves to whether the
 * microphone may be used; without it voice still joins, listening only.
 */
export async function ensureMicrophonePermission(): Promise<boolean> {
  if (!isAndroidTauri()) return true;
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    stream.getTracks().forEach((track) => track.stop());
    return true;
  } catch {
    return false;
  }
}
