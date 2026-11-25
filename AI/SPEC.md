# Kolpak — technical specification

Status: pre-implementation. Nothing here has been built or tested. Section 2 was checked against Sable's code on 2026-11-25 (details in `FORK-NOTES.md`). Mumble and stream details are still from memory of their documentation and must be verified during the spikes. Items marked **TBD** need input from the owner.

## 1. Product

A custom client for the KLPQ (Podkolpakom) community that combines three existing, separate services in one lightweight cross-platform app:

1. **Matrix** — text chat (spaces, rooms, DMs, media, GIFs).
2. **Mumble** — voice.
3. **Stream service** — live video channels run by the community.

### Goals

- One app, one window: chat with streams and voice docked beside it.
- Lightweight: no Electron. Idle memory and install size clearly below Element Desktop/Discord.
- Cross-platform: Windows, macOS, Linux first; Android next; iOS last.
- Themeable by the community with plain CSS.
- Works against the community's existing servers. No server-side changes required for v1.

### Non-goals (v1)

- Replacing Mumble with Matrix/WebRTC calls.
- Being a general-purpose Matrix client for other communities (it should still work on any homeserver, but the product decisions are KLPQ's).
- Broadcasting a stream from the app (viewing only).
- Server administration UIs.

## 2. Stack

| Layer | Choice | Why |
|---|---|---|
| Shell | **Tauri 2** | Rust core + system webview; small binaries; desktop and mobile from one project |
| Frontend | **React + TypeScript**, forked from the **Sable** client | Mature Matrix UI to start from instead of writing a timeline from scratch |
| Matrix | **matrix-js-sdk** (inherited from the fork) | Comes with the fork; E2EE via its Rust crypto WASM |
| Mumble | **Rust, in the Tauri core** | Needs raw TCP/TLS + UDP and low-latency audio I/O, which a webview cannot do |
| Streams | HTML5 `<video>` + **hls.js** / **mpegts.js** / WebRTC | Covers HLS, HTTP-FLV and low-latency options in a webview |
| Styling | Sable's `--sable-*` CSS-variable themes for inherited UI; plain CSS with cascade layers for new Kolpak components | User-themeable without a build step; Sable already imports user theme and tweak CSS |

Verified 2026-11-25 (see `FORK-NOTES.md`):
- Sable is a Cinny fork, AGPL-3.0-only, React 19 + Vite 8 + pnpm, vanilla-extract + `folds`, matrix-js-sdk 42. Kolpak must be AGPL.
- Sable already contains a Tauri 2.11 shell (`src-tauri/`) building Windows, macOS, Linux, Android and iOS, with tray, updater, global shortcuts, notifications and deep links. Section 9's desktop integration list is mostly inherited, not built.
- Decision: keep Sable's styling system. Kolpak's look is a built-in theme over `--sable-*` variables plus a small override layer; new components use plain CSS.
- The fork's UI is kept. New work is the live dock, status bar and theater, and a restyle of the space rail, room list and chat column.

## 3. Architecture

```
┌──────────────────────────── webview (React/TS) ────────────────────────────┐
│  Matrix UI (fork)      Live dock / Theater        Status bar                │
│  matrix-js-sdk         <video> + hls.js/mpegts    stores: voice, streams    │
│        │                     │                          ▲                   │
│        │ HTTPS/sync          │ HTTP(S) media            │ events            │
└────────┼─────────────────────┼──────────────────────────┼───────────────────┘
         │                     │              invoke() ▼  │ emit()
         │                     │        ┌──────── Tauri core (Rust) ─────────┐
         ▼                     ▼        │ mumble: control (TCP/TLS)          │
   Matrix homeserver     Stream server  │         voice (UDP, Opus, crypto)  │
                                        │ audio:  capture/playback, VAD/PTT  │
                                        │ streams: status poller (optional)  │
                                        │ os: tray, hotkeys, notifications,  │
                                        │     secure storage, autostart      │
                                        └───────────────┬────────────────────┘
                                                        ▼
                                                  Mumble server
```

Rules:
- Voice audio never crosses the JS bridge. Capture, encode, network, decode and playback all stay in Rust. The webview only receives state (who is talking, levels at ≤20 Hz) and sends commands.
- Stream video is played by the webview directly from the stream server.
- Matrix stays entirely in the webview for v1.

## 4. Matrix

Inherited from the fork; scope here is what must work and what changes.

Must work: login (password and SSO if the homeserver has it), sync (sliding sync if the server supports it), spaces and room list, timeline with replies/edits/reactions/redactions, media upload/download, typing and read receipts, DMs, notifications, E2EE with device verification and key backup, room search.

Kolpak-specific:
- **Space rail** drives the room list (see DESIGN.md §3.1).
- **GIFs/stickers**: picker in the composer; inline animated rendering. Sable ships a Tenor/Klipy/Giphy picker behind its own proxy and keys; Kolpak needs its own keys or proxy, or a community sticker/GIF pack room. **TBD**.
- **Inline embeds**: URL previews via the homeserver's preview endpoint; video links render the compact embed card.
- **ON AIR timeline rows**: client-generated (not Matrix events) from the stream status feed, unless the community later adds a bot that posts real events. Shown in a designated room per space. **TBD** which room.
- **Stream ↔ room mapping**: which Matrix room is the chat for which stream channel. Proposal: a client config map `streamChannel → roomId`, later movable into a custom state event on the space so every client agrees.
- Homeserver is preset to the community's but editable on the login screen (`config.json`: `homeserverList`, `allowCustomHomeservers`).
- Sable's Matrix calls (Element Call / LiveKit) are hidden; voice is Mumble.

## 5. Mumble (Rust)

### 5.1 Protocol

- **Control channel**: TCP + TLS to the server (default port 64738). Length-prefixed protobuf messages (2-byte type, 4-byte length). Handshake: `Version` → `Authenticate` (username, optional password, `opus = true`) → server sends `CryptSetup`, `CodecVersion`, channel and user state, `ServerSync`. Keep-alive `Ping` every ~15 s.
- **Voice channel**: UDP to the same host/port, encrypted with the key/nonces from `CryptSetup` (OCB2-AES128). Fallback: tunnel voice packets through the TCP connection (`UDPTunnel`) when UDP is blocked; detect via UDP ping.
- **Codec**: Opus, mono, 48 kHz, 10–20 ms frames (configurable up to 60 ms), bitrate bounded by the server's `max_bandwidth`.
- **Packet format**: Mumble 1.5 introduced a protobuf-based UDP format alongside the legacy one. The community server is `mumble.klpq.io:64738` and answered a server-list ping on 2026-11-25 as version 1.5.x (the legacy version field reads 1.5.255, which is how 1.5 reports a patch number above 255), 100 user slots, 558 kbit/s bandwidth cap. So the protobuf UDP format is available; a 1.5 server still accepts the legacy format from older clients. Implement the 1.5 format first.
- **Certificates**: Mumble identifies users by client certificate. Generate a self-signed cert on first run, store it in OS secure storage, allow import/export so users keep their registered identity from the official client. Server cert: trust-on-first-use with a pinned fingerprint prompt (most community servers are self-signed).

### 5.2 Features

v1: connect/disconnect, auto-reconnect with backoff, channel tree with live user states, join/move channel, talk (voice activity and push-to-talk), self mute/deafen, per-user local volume and local mute, talking indicators, latency display, text-message receive (shown as a toast; sending is low priority).

Later: positional audio (no), whisper/shout targets, channel listeners, ACL/admin actions, recording.

### 5.3 Audio pipeline

Capture → resample to 48 kHz mono → noise suppression (RNNoise-class) → VAD or PTT gate → Opus encode → encrypt → send.
Receive → decrypt → per-user jitter buffer → Opus decode (with PLC/FEC) → per-user gain → mix → output.

- Echo cancellation is needed on mobile and for speaker users on desktop; plan for a WebRTC-audio-processing-class AEC behind a setting.
- Device selection and hot-plug handling for input and output.
- Stream audio (webview) and voice audio (Rust) are separate outputs; provide independent volume and an optional "duck stream while someone talks" setting.

### 5.4 Candidate crates (verify maintenance and licences)

`tokio`, `tokio-rustls` or `native-tls`, `prost` with the upstream `Mumble.proto` (or the `mumble-protocol` crate), `opus`/`audiopus`, `cpal` for audio I/O, `rubato` for resampling, `nnnoiseless` for denoising, `rcgen` for the client cert, `keyring` or the Tauri secure-storage plugin.

### 5.5 Bridge API (Tauri)

Commands (webview → Rust):

```
mumble_connect({ host, port, username, password? })
mumble_disconnect()
mumble_join_channel({ channelId })
mumble_set_self({ mute?, deafen? })
mumble_set_user_volume({ session, gain })      // local only
mumble_set_user_local_mute({ session, muted })
mumble_set_transmit({ mode: "vad" | "ptt" | "continuous", vadThreshold? })
mumble_ptt({ down })
audio_list_devices() / audio_set_devices({ input?, output? })
audio_set_volumes({ input?, output? })
```

Events (Rust → webview):

```
mumble://state        { status: "disconnected"|"connecting"|"connected"|"reconnecting", error? }
mumble://channels     { channels: [{ id, parent, name, position }] }   // full, then diffs
mumble://users        { users: [{ session, name, channelId, mute, deaf, selfMute, selfDeaf }] }
mumble://talking      { session, talking }
mumble://stats        { pingMs, udp: boolean, loss }
mumble://text         { from, channelId?, message }
audio://levels        { input }                                          // ≤20 Hz, only while settings open
```

The frontend keeps a `voice` store fed only by these events; UI never calls into Mumble state synchronously.

## 6. Streams

Facts, read on 2026-11-25 from the station site's source (`klpq/klpq-angular`, a React/Vite app despite the name) and checked against the live API:

- **Stats API**, base `https://stats-api.klpq.io/v1` (in `config.json` as `streamStatsUrl`). It answers with `Access-Control-Allow-Origin: *`, so the webview can poll it directly; no Rust poller is needed.
  - `GET /streams?limit=1`: broadcast history. `options.channels` is the list of every known channel (seven when checked), `total` and `info.totalDuration` are station totals.
  - `GET /channels/{name}`: `{ streams: [...] }`, one entry per protocol currently served. An empty list means off air. Each entry has `app`, `protocol`, `viewers`, `duration` (seconds), `bitrate` (kbps), `startTime`, `userName` and `urls.edge` (the playback URL) and `urls.web`.
  - The site polls every 10 s and sends an optional `jwt-token` header taken from its own login; public data does not need it.
- **Protocols seen:** `rtmp` (ingest, not playable in a webview) and `flv`, whose edge URL is **FLV over WebSocket** (`wss://…/live/{channel}.flv`). The site also handles `hls` and `mpd` (DASH) when the server offers them, and lists one quality per protocol/app pair.
- **Players the site uses:** mpegts.js for FLV (`{ type: 'flv', isLive: true, cors: true }`), hls.js for HLS with native playback on iOS, dash.js for DASH with native playback on Android. The dock mockup's three stats are viewers, uptime (`duration`) and bitrate, all present in the API.
- **Channels are not a fixed list:** they come from the API; the default channel is `stream`.
- The site has no licence file. Kolpak's `src/kolpak/streams` is written from the API's behaviour, not copied from it.

Built so far: `src/kolpak/streams/stats.ts` (fetchers and pure logic) and `useStreamChannels.ts` (polling hook), feeding the status bar. No player yet.

Design:
- `StreamProvider` interface: `listChannels()`, `status(channel) → { live, viewers?, startedAt?, bitrateKbps?, title? }`, `sources(channel) → [{ kind: "flv"|"hls"|"dash"|"webrtc", url }]`.
- Status polling every 10–15 s (or a push channel if the service has one). If the API lacks CORS headers, poll from Rust and emit `streams://status`.
- Player picks the best available source per platform, user-overridable with the FLV/HLS/DASH switch:
  - HTTP-FLV via mpegts.js: lowest latency of the HTTP options; needs Media Source Extensions.
  - HLS via hls.js where MSE exists; native HLS in WKWebView (macOS/iOS).
  - DASH would need a third library (dash.js or Shaka) — include only if the service really serves it.
  - WebRTC (WHEP) if the server supports it, for sub-second latency.
- Platform caveat: MSE availability on iOS WKWebView is limited (ManagedMediaSource on recent iOS only), so iOS should default to native HLS. Linux WebKitGTK needs GStreamer plugins installed for H.264/AAC; test early and document or bundle.
- One player instance survives layout changes: moving between dock and theater re-parents the same `<video>` rather than reloading.
- Live-edge controls: "jump to live", latency readout, volume, mute, fullscreen, picture-in-picture where the webview supports it.

## 7. Frontend structure

```
src/
  app/            fork's Matrix UI (restyled)
  kolpak/
    layout/       SpaceRail, RoomList, ChatColumn, LiveDock, StatusBar, Theater
    voice/        store, bridge bindings, VoiceTree, VoiceControls
    streams/      providers, store, Player, ChannelStrip, OnAirRow
    theme/        tokens.css, base.css, components/*.css, themes/*.css
src-tauri/
  src/mumble/     control.rs, voice.rs, crypto.rs, state.rs
  src/audio/      capture.rs, playback.rs, dsp.rs, mixer.rs
  src/streams/    poller.rs
  src/os/         tray.rs, hotkeys.rs, storage.rs
```

Keep Kolpak code in its own directories so upstream merges from the fork stay manageable.

State: three independent stores (matrix — the fork's; voice; streams). The status bar and dock subscribe to all three. A failure in one service must never block the other two: the app is usable as a plain Matrix client with Mumble and streams down.

## 8. Theming

Inherited UI: Sable themes are CSS files setting `--sable-*` custom properties; users import themes and tweak CSS from a catalog, a URL, a file or pasted text. Kolpak ships its look as the default built-in theme and points the catalog at its own repo (or disables it).

New Kolpak components: `@layer reset, tokens, base, components, theme, user;` with tokens as CSS custom properties (see DESIGN.md §2.3), reading the same theme variables where they exist. Fonts are bundled.

## 9. Platform

| | Notes |
|---|---|
| Windows | WebView2 (preinstalled on Win 11; bootstrapper for Win 10). Global PTT hotkey works while unfocused. |
| macOS | WKWebView. Microphone permission string; notarisation and signing needed for distribution. |
| Linux | WebKitGTK. Media codecs via GStreamer. Global hotkeys are restricted under Wayland — PTT may need the portal or a focused-only fallback. |
| Android | System WebView. Voice in background requires a foreground service of microphone type with a persistent notification; audio focus and Bluetooth routing handled natively (Kotlin plugin or JNI). **This is the go/no-go spike for mobile voice.** |
| iOS | WKWebView. Background audio mode + audio session configured for voice chat; CallKit optional. Requires a Mac and an Apple developer account. Last. |

Desktop OS integration: tray icon with mute/deafen/quit, close-to-tray, native notifications, autostart option, global hotkeys (PTT, mute, deafen), single-instance, `matrix:` URI handling, auto-update (Tauri updater; needs a signing key and a place to host releases — **TBD**).

## 10. Security and privacy

- Matrix access token, Mumble password and client certificate live in OS secure storage, never in plain files or localStorage if avoidable.
- Tauri capabilities restricted to the commands listed; no arbitrary shell or filesystem access from the webview. Strict CSP; remote content limited to the homeserver, media repo, stream hosts and the GIF provider.
- Mumble server certificate pinned after first trust; warn loudly on change.
- No telemetry. Sable includes Sentry, inactive unless a DSN is supplied at build time; Kolpak builds supply none.

## 11. Performance targets (to validate, not promises)

- Cold start to usable room list: under 3 s on a mid-range laptop.
- Idle RAM (chat only): under 300 MB; with stream + voice: under 500 MB.
- Voice mouth-to-ear added latency from the client: under 60 ms on desktop.
- Installer: under 30 MB on desktop.

## 12. Plan

| Spike | Goal | Done when |
|---|---|---|
| 1 | Fork Sable (already Tauri 2), build it unmodified, then rebrand | Login, sync and send a message on each target; no Sable endpoints or keys left in config |
| 2 | Mumble voice on desktop | Two-way audio with the official client on the community server; tree and talking events in a debug UI |
| 3 | Stream player in-app while Mumble is connected | Stream plays in the dock with voice active; no audio glitches; dock ↔ theater without reload |
| 4 | Mumble on Android in background | 30 min screen-off call survives; Bluetooth headset works. Go/no-go for mobile voice |
| 5 | iOS variant | Same as 4 on iOS |

After the spikes: apply the design (tokens, layout shell, dock, status bar, theater), then settings, OS integration, packaging and updates.

## 13. Inputs still needed from the owner

- **Matrix**: homeserver URL, two test accounts, a test space.
- **Mumble**: host, port, server version, a test channel, whether a server password or registered certs are in use.
- **Streams**: playback protocol(s), example stream URL, channel list, API for live status and stats.
- **Project**: app display name, bundle identifier (suggested `com.klpq.kolpak`), public vs. private repo, where releases are hosted.
- **Toolchain on the dev machine**: Rust (stable), Node.js LTS, CMake, platform build tools (MSVC Build Tools + WebView2 on Windows; Xcode CLI tools on macOS), Android Studio/NDK for spike 4.
- **GitHub**: the Claude GitHub App is not installed for the `klpq` org, so cloud sessions can read this repo but not push.
