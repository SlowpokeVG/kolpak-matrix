# Kolpak's copy of tauri-plugin-notifications

Taken from SableClient's fork, `https://github.com/SableClient/tauri-plugin-notifications`,
commit `92c96b300517c49024a48aaff863338e3bd63616` (the revision Sable 1.22.11 pins), MIT
licence (`LICENSE`). `src-tauri/Cargo.toml` points the git dependency here with a
`[patch]` entry, so the rest of the app is unchanged.

Kolpak's changes, all in `android/`:

- **Pushes go to the webview first when it is listening.** Upstream posted a native
  "Encrypted message" notification for every push (sound, pop-up) and then handed the push
  to the webview, which decrypted it and updated the notification silently, so the pop-up
  always showed the placeholder. The native path cannot decrypt in this app: the room keys
  live in the webview's crypto store, and the app does not export the `nativeDecryptPush`
  JNI symbol the plugin looks for. Now `EmbeddedPushService` and `UnifiedPushReceiver`
  give the push to the webview when its listener is active and its activity alive, and post
  the native notification only when it is not (or the hand-off fails).
- **The foreground-service notification** ("Background connection") uses the app's own
  notification icon and says what it is for.

Search for `Kolpak` in `android/` for the exact places.
