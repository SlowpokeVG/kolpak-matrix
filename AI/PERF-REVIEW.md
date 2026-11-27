# Battery and resource review (2026-11-27)

The owner asked, before the native-crypto work: does the client keep a browser running and
busy in the background, and what costs battery? This is what the code does and what was
measured. "Confirmed" items were re-read in the code after the inventory; the rest come from
the inventory and carry its file:line references.

## Measured

Web build (`dist/`) in Playwright's Chromium at phone size, against a local Synapse: an
account in 15 rooms with 100 messages each, and a bot editing one message every 5 s (like
the Mumble activity bot). CDP `Performance.getMetrics` deltas, timers counted by wrapping
`setTimeout`/`setInterval`/`requestAnimationFrame`. Limits: desktop Chromium, not a phone; it
measures the app's own work, not the WebView process; "hidden" only flips
`document.visibilityState` (no Chrome background throttling).

| Phase (2 min each) | CPU (task) | Script | Heap | Requests/min |
|---|---|---|---|---|
| Login + first sync (20 s) | 1.7 s total | 0.46 s | 24 MB | |
| Room list, visible | 0.13 s/min | 0.06 s/min | 24 MB | /sync 12 |
| Room with the editing bot, visible | 0.32 s/min | 0.18 s/min | 33 MB | /sync 26, read_markers 12 |
| Same, hidden | 0.33 s/min | 0.16 s/min | 29 MB | /sync 25, read_markers 12 |

The app's own JavaScript is cheap (a third of a second of CPU per minute). The costs are
elsewhere: network wake-ups (sync, receipts, the push socket), the voice path, and the
WebView process itself.

## Findings, by battery impact on the phone

1. **Voice keeps everything open while connected** (confirmed).
   - The microphone stream opens when connected and stays open muted, in push-to-talk with
     the key up, and deafened; mute is only a flag (`src-tauri/src/mumble.rs:649`,
     `crates/kolpak-mumble/src/audio.rs:363-386`). Every 10 ms frame is resampled and run
     through RNNoise before the gate; only the Opus encode is skipped.
   - Playback stays open mixing silence when nobody talks or when deafened
     (`mumble.rs:509`, `playback.rs:217-331`).
   - `VoiceService` holds a 12 h partial wake lock and a `WIFI_MODE_FULL_LOW_LATENCY` lock
     (Wi-Fi power saving off) for the whole session (`VoiceService.kt:127-143`).
   - Mic levels go to the webview up to 10 times a second (`mumble.rs:409-437`), and every
     `useVoice()` subscriber re-renders, status bar and mobile bar included, also hidden.
   - UDP ping every 5 s, TCP every 15 s (normal for Mumble).
   - Windows: the push-to-talk key is polled every 10 ms for the whole connection, in every
     transmit mode (`mumble.rs:54,387-403`).
2. **A read receipt for every bot edit** (measured, confirmed). `latestReceiptTarget`
   (`src/app/utils/notifications.ts:5`) takes the newest event, edits included, so in a room
   with the Mumble bot the client posts `read_markers` every time the bot edits: 12 a minute in
   the test, hidden or not. Each is a radio wake-up.
3. **Classic sync never pauses in the background.** Sable pauses only sliding sync, and only
   on mobile Tauri (`useSyncOrchestrator.ts:66-77`); classic sync, the default, long-polls
   forever. With a chatty bot it returns every few seconds. On the phone this either drains
   the battery (if the WebView runs in the background) or does nothing useful (if Android
   freezes it, which the missing overnight keys suggest). With the native crypto work the
   push service fetches keys itself, and sync can then stop when the app is hidden, as in
   Element.
4. **Push service radio wake-ups** (`EmbeddedPushService.kt`): an OkHttp ping every 30 s on
   the ntfy websocket (`:150`), a 15 min alarm that only re-arms the service, reconnects that
   replay 12 h of messages on every network switch (`:158`), retries every 120 s while
   offline each taking a wake lock, and a wake lock kept until its 30 s timeout when
   `connect()` returns early (`:156`).
5. **Per-frame loop in call views** (confirmed): `useCallEmbed.ts:265-286` runs
   `requestAnimationFrame` with `getBoundingClientRect` every frame while a call view is
   mounted, even with no call embed, which includes rooms that merely have call members.
6. **Stream dock**: a 1 s `setInterval` re-render (`useStreamView.ts:16-23`), also off air and
   hidden; stats are fetched every 10 s per channel (paused when hidden by React Query).
7. **Android system bar sampling**: two `MutationObserver`s on the whole `body` subtree, each
   batch followed by `elementFromPoint`/`getComputedStyle` sampling (`SystemBarShell.tsx`).
8. **Small timers that never stop**, together about 3.5 wake-ups a second (measured): the 2 s
   visibility recheck (`useSyncOrchestrator.ts:21`, on every platform), the 1.5 s console
   warning (`consolePasteScamWarning.ts:60`), the 5 s call fallback (`useCallSignaling.ts:596`),
   the 10 s network check (`useNetworkRecovery.ts`).
9. **Desktop**: closing the window hides it to the tray (`desktop/tray.rs:62-81`) and the
   WebView keeps running everything; nothing lowers work while hidden. WebView2 is the
   system's (no bundled Chromium); CEF is Linux only. Every media-cache write stats every file
   in the 512 MB cache (`media_protocol.rs:993-1025`).
10. **A call service that can leak**: `stopCallForegroundServiceNative` throws once
    `MainActivity` is gone (`MainActivity.kt:329`), and the service has no `onTaskRemoved`,
    so its notification, audio focus and 1 h wake lock can outlive the call.
11. **Kolpak's push-key copy** (temporary, goes away with native crypto): each run scans
    every room key in the wasm store, and a 60 s heartbeat writes a status file while hidden.

Not a problem: the service worker is not registered in Tauri; Sentry is off unless baked in
and consented; the updater is off in CI builds; the loopback media server idles in `accept`.

## Suggested order

1. Quick wins, low risk: voice (close the mic when not transmitting, pause playback when
   silent or deafened, drop the low-latency Wi-Fi lock and the 12 h wake lock, levels only
   while someone looks at them, PTT polling only in PTT mode), receipts only for displayed
   events and never while hidden, the call-view loop only with an embed, the stream tick only
   when live and visible, the small timers paused while hidden, the push socket's ping and
   replay window, the leaked call service.
2. Native crypto with an Element-style key sync in the push service; then stop sync while the
   app is hidden on Android.
