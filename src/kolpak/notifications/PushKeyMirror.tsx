import { useEffect } from 'react';
import { useMatrixClient } from '$hooks/useMatrixClient';
import { isAndroidTauri } from '$utils/platform';
import { startPushKeyMirror } from './pushKeyMirror';

/** Android: keeps the native push path's copy of the room keys fresh (pushKeyMirror.ts). */
export function PushKeyMirror() {
  const mx = useMatrixClient();
  useEffect(() => {
    if (!isAndroidTauri()) return undefined;
    const mirror = startPushKeyMirror(mx);
    return () => mirror.stop();
  }, [mx]);
  return null;
}
