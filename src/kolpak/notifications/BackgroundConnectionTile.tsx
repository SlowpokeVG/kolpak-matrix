import { invoke } from '@tauri-apps/api/core';
import { Button, Text } from 'folds';
import { SettingTile } from '$components/setting-tile';
import { useSetting } from '$state/hooks/settings';
import { settingsAtom } from '$state/settings';
import { isAndroidTauri } from '$utils/platform';

// Settings → Notifications, under background notifications, Android only.
//
// Background notifications on Android without Google Play keep a connection open in a
// foreground service, and Android requires such a service to show a notification: the
// "Background connection" entry in the shade. Its channel can be switched off in Android's
// settings; the service keeps running and messages keep arriving. This opens that page.

export function BackgroundConnectionTile() {
  const [backgroundPushEnabled] = useSetting(settingsAtom, 'backgroundPushEnabled');
  if (!isAndroidTauri() || !backgroundPushEnabled) return null;
  return (
    <SettingTile
      title="Hide “Background connection”"
      focusId="kolpak-background-connection"
      description="Android shows this while Kolpak keeps the connection that delivers messages. Switch it off on the page that opens; notifications keep coming."
      after={
        <Button
          size="300"
          variant="Secondary"
          fill="Soft"
          radii="300"
          outlined
          onClick={() =>
            void invoke('kolpak_open_background_connection_settings').catch(() => undefined)
          }
        >
          <Text size="B300">Open</Text>
        </Button>
      }
    />
  );
}
