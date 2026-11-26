# Kolpak's copy of tauri-plugin-notifications

Taken from SableClient's fork, `https://github.com/SableClient/tauri-plugin-notifications`,
commit `92c96b300517c49024a48aaff863338e3bd63616` (the revision Sable 1.22.11 pins), MIT
licence (`LICENSE`). `src-tauri/Cargo.toml` points the git dependency here with a
`[patch]` entry, so the rest of the app is unchanged.

Kolpak's changes, all in `android/`:

- **Decrypt first, post once.** Upstream posted a native "Encrypted message" notification
  for every push (sound, pop-up), tried a native decryptor this app did not have, and handed
  the push to the webview, which updated the notification silently; so the pop-up always
  showed the placeholder. Now the app exports the `nativeDecryptPush` JNI symbol
  (`src-tauri/src/push_keys.rs`), backed by a copy of the webview's room keys that the
  webview keeps fresh (`src/kolpak/notifications/pushKeyMirror.ts`).
  `UnifiedPushNotifier.showFromPush` decrypts before posting and posts once, with the text;
  it returns `Shown.PLACEHOLDER` when the key is not in the copy, and the caller then offers
  the push to the webview (`offerToWebview`), which updates the notification in place.
- **Routing.** While the app is on screen (`NotificationPlugin.isAppOnScreen`: the activity
  is at least STARTED, picture in picture included) `EmbeddedPushService` and
  `UnifiedPushReceiver` give the push to the webview, which runs at full speed then and
  knows which room is open. In the background the native path posts (the webview barely
  runs there, which made notifications late). Activation pushes (`ack_token`) always go to
  the webview, which finishes the registration with them.
- **Stacking.** A room's notification keeps its last six messages (MessagingStyle), like
  other messengers, instead of showing only the newest; a redelivered event is not added
  twice and does not alert again. Images, files and voice messages say what they are.
- **The foreground-service notification** ("Background connection") uses the app's own
  notification icon and says what it is for.

Search for `Kolpak` in `android/` for the exact places. The unit tests in `android/src/test`
were updated to match and pass (`./gradlew :tauri-plugin-notifications:testFossDebugUnitTest`
from `src-tauri/gen/android`; in a cloud session Robolectric needs
`-Drobolectric.dependency.repo.url=https://maven-central.storage-download.googleapis.com/maven2`
in `JAVA_TOOL_OPTIONS`, because Maven Central answers its proxy with 429).
