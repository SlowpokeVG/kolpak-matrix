# Kolpak — handoff

For whoever (person or Claude session) picks this project up next. Read this first, then `FORK-NOTES.md`, `SPEC.md` and `DESIGN.md`.

## What this is

A custom Matrix client for the KLPQ / Podkolpakom community that puts Matrix chat, Mumble voice and the community's stream service in one lightweight cross-platform app. Repo: `klpq/kolpak-matrix`. Working name: **kolpak**.

## Where things stand

| Area | State |
|---|---|
| Feasibility | Assessed: straightforward on desktop; mobile voice in the background is the main risk |
| Stack | Chosen: Tauri 2, React + TypeScript forked from Sable, matrix-js-sdk, Mumble in Rust, HTML5 video with hls.js/mpegts.js, theming through Sable's CSS-variable themes |
| Fork | Read and web-built on 2026-11-25 (see `FORK-NOTES.md`). Sable already ships a Tauri 2 shell for desktop, Android and iOS |
| Branding | Drafted: logo, palette, type, components |
| Desktop UI | Drafted: main client view and theater mode |
| Mobile UI | Concept only (swipe panes + pull-up dock) |
| Code | Sable `v1.22.11` merged with history; builds and runs on Windows with two small fixes (see "Spike 1 log") |
| Service access | Matrix homeserver and two test accounts given in session on 2026-11-25; no Mumble or stream details yet |

Nothing of ours has been built or tested beyond launching the fork to its login screen. Sable's facts in `FORK-NOTES.md` were read from its code; the Mumble and stream claims in `SPEC.md` are still from memory and need checking when those spikes start.

## Files

```
AI/
  HANDOFF.md              this file
  FORK-NOTES.md           what Sable actually is, and what that changes
  SPEC.md                 technical specification, bridge API, plan, open inputs
  DESIGN.md               brand, tokens, layout measurements, components
  header-font-cyrillic.png  header font candidates set in Latin and Cyrillic
  logo.svg                the Guy, clean paths (no hand-drawn filter)
  mockups/
    Main.dc.html          brand sheet
    Client.dc.html        main client view
    Theater.dc.html       theater mode
```

Plan board: https://claude.ai/artifact/My7r8F3pvsPA9Lb4oyftj5 (private to the owner).

The mockup files are sources from the design canvas at https://claude.ai/artifact/2vCeh1gFAC6JWsTz2w59mK (private to the owner). They will not render on their own; read the inline styles for exact values, or open the canvas.

## Decisions already made (don't reopen without a reason)

1. **No Electron.** Tauri 2 with the system webview.
2. **Fork an existing Matrix client UI (Sable)** rather than write a timeline from scratch.
3. **Mumble is implemented natively in Rust** inside the Tauri core. Voice audio never passes through JavaScript.
4. **Mumble stays.** Voice is not being moved to Matrix calls.
5. **Layout**: space rail · room list · chat · collapsible live dock (stream on top, voice tree below) · inverted status bar along the bottom. Theater mode swaps the room list for a large player with chat on the right.
6. **Look**: black / paper grey / orange, hard edges, solid fills, no glow, no rounded corners except the app icon. Anton for headers, JetBrains Mono for everything else, marker font only for the "Podkolpakom" signature.
7. **The logo character is never altered** and always shown in full.
8. **Colour meanings**: orange = live / needs attention; green = voice and presence; blue = decoration.
9. **Themeable** via CSS custom properties and cascade layers, with a user CSS layer on top.
10. **Order of platforms**: desktop (Windows, macOS, Linux) → Android → iOS.

## Last design iteration

The owner asked for three changes to the main client mockup:

- Room title in the centre made smaller — done: header 52→46px, title Anton 22→16px, avatar 28→24px. **Not yet confirmed by the owner, and not visually checked after the change.**
- Space selection in the left sidebar — the space rail was already present; left as is. Unconfirmed whether that is what was meant.
- Layout closer to the earlier Matrix-style mockup — no further change made; unconfirmed.

## Known risks, in order

1. **Mobile background voice** (Android foreground service, iOS audio session). Spike 4 is a go/no-go; if it fails, mobile ships chat + streams with voice desktop-only.
2. **The fork.** Confirmed AGPL-3.0, so Kolpak is AGPL too. The styling question is settled (theme on top of Sable's variables, see `FORK-NOTES.md`). ~~What remains is the cost of tracking a fast-moving upstream~~ — as of 2026-10-16 upstream is "Sable Legacy" and unmaintained (see the Spike 1 log); the fork is ours to maintain alone.
3. **Stream playback across webviews.** MSE on iOS, codecs on Linux WebKitGTK, CORS on the status API. The stream service's actual protocols are still unknown.
4. **Mumble server version** decides which UDP packet format to implement.
5. **Cyrillic in the header font.** Confirmed: Anton and Permanent Marker have no Cyrillic glyphs. Proposed fix in `DESIGN.md` §2.4 (Oswald 700 as the Cyrillic fallback); needs the owner's eye.
6. **Global push-to-talk under Wayland.**
7. **Distribution**: code signing (Windows, macOS), update hosting, app stores for mobile.

## Blocked on the owner

- Matrix: homeserver URL, two test accounts, a test space.
- Mumble: ~~host, port, version~~ (received and probed 2026-11-25, see SPEC §5.1); still needed: test channel, password/cert policy.
- Streams: ~~protocols, example URL, channel list, status API~~ (read from the station site and the live API on 2026-11-25, see SPEC §6).
- App display name and bundle ID (suggested `com.klpq.kolpak`); public or private repo.
- Confirmation of the last design iteration; community slang for UI copy; UI language(s).
- Whether the repo is public (AGPL requires source for anything distributed).
- Header font choice for Cyrillic (see `header-font-cyrillic.png`).
- GitHub: cloud sessions cannot push to `klpq/kolpak-matrix` until the Claude GitHub App is installed for the org. Working from a local machine avoids this.

## Next steps

1. **Check the dev machine**: Node 24, pnpm 11, Rust 1.97.1, Visual Studio Build Tools (C++ workload), WebView2.
2. **Spike 1** — fork and run (commands in `FORK-NOTES.md`):
   1. ~~Read Sable's licence and build setup~~ done 2026-11-25; fork with history.
   2. Merge Sable `v1.22.11` into this repo; `pnpm install`; `pnpm tauri dev` on Windows, unmodified.
   3. Log in to the test homeserver, sync, send a message. Record build size and idle memory.
   4. Rebrand: name, identifier, icon, homeserver preset, and every Sable-owned endpoint and key in `config.json` / `tauri.conf.json` (the updater key above all).
   5. Repeat on the other desktop OSes and Android.
3. **Spike 2** — Mumble on desktop in Rust: control connection and channel tree first (no audio), then receive audio, then transmit. Test against the community server alongside the official client.
4. **Spike 3** — stream player in the dock with voice connected.
5. Apply the design: Kolpak theme over `--sable-*` variables → layout shell → dock → status bar → theater.
6. Spikes 4 and 5 (mobile) once desktop is usable daily.

Write down what each spike actually found (versions, sizes, what broke) in this file as it happens, and correct `SPEC.md` where reality differs.

## Spike 1 log

### 2026-11-25 — merge, install, first `tauri dev` (Windows 11, local machine)

**Merge.** `upstream` remote added (`SableClient/Sable`). Tag `v1.22.11` is commit `98416a9` (2026-09-30), not the `3adfe1e` on `dev` that `FORK-NOTES.md` was read from; the tag was used. Local branch `sable-base` points at the tag. Merged into `main` with `--allow-unrelated-histories` as `7fd70f17b`; 7,321 commits of history; the only conflict was `README.md` (kept ours). Not pushed. `AI/` is still untracked.

The merge brought in Sable's `CLAUDE.md` / `AGENTS.md` / `COPILOT.md` / `.cursorrules`. They are written for people contributing to Sable and will be picked up as project instructions by any agent opened in this repo. Decide whether to replace them with our own.

**Machine as found.**

| Tool | Wanted | Found |
|---|---|---|
| Node | ^24.18 | 22.23.2 (`D:\Program Files\nodejs`) |
| pnpm | 11.18.0 | not installed; `corepack enable` fails with EPERM (needs an elevated shell to write into `D:\Program Files\nodejs`) |
| Rust | 1.97.1 | 1.99.1 stable; rustup installed 1.97.1 on its own from `rust-toolchain.toml` |
| MSVC | C++ workload | Visual Studio Build Tools 2026 (18.7) with VC tools |
| WebView2 | any | 158.0.4370.33 |
| git identity | — | no `user.name` / `user.email` configured; the merge commit was made with `-c` overrides matching the initial commit's author |

**Install.** `corepack pnpm install` works without `corepack enable`: 54 s, lockfile unchanged, including the `tauri-plugin-app-icon-api` GitHub tarball that failed in the cloud workspace. Node 22 did **not** block the install despite `engineStrict: true` and `devEngines` asking for ^24.18; Vite 8 dev server also starts on Node 22. Node 24 is still the supported version and should be installed.

`pnpm tauri dev` runs `pnpm dev` as its `beforeDevCommand`, so a real `pnpm` must be on `PATH` (`corepack pnpm tauri dev` alone is not enough). For this run a shim directory was made with `corepack enable --install-directory <dir> pnpm` and prepended to `PATH`. The permanent fix is one `corepack enable` from an elevated shell.

**Upstream is frozen.** The last commit on `upstream/dev` (`3adfe1e`, 2026-10-16) renames the project to "Sable Legacy" and its README says it is no longer actively maintained; development moved to a rewrite, "Sable v2", at `git.sable.moe/SableClient/Sable-next`. `v1.22.11` is the newest tag and `dev` is one README commit ahead of it. This reverses the "upstream moves fast" risk: there will be few or no upstream merges to track, and no upstream fixes either. Sable v2 has not been looked at (licence, stack, whether it is the Electron app found on this machine). **Decision #2 (fork Sable) should be re-confirmed by the owner with this in mind.**

**`v1.22.11` does not compile for Windows as tagged.** Commit `6ccd623` (release day) pinned `tauri-codegen = "2.7.0"` for Android asset ordering. On Windows targets 2.7.0 generates a call to `tauri::image::default_window_icon_from_app_icon_resource()`, which `tauri` 2.11.5 does not have (`error[E0425]` at `src/lib.rs:535`). Fix applied in `src-tauri/Cargo.toml`: `tauri-codegen = "~2.6.3"` in both `[build-dependencies]` and `[dev-dependencies]` (the line `tauri-macros`/`tauri-build` 2.6.3 expect). Side effect: `src-tauri/tests/asset_reproducibility.rs` relies on 2.7 behaviour and has not been run.

**Never run a plain `pnpm tauri dev` on this machine while the identifier is `moe.sable.client`** (it no longer is; see the rebrand entry below, but this applies again to any checkout of the unmodified merge commit). An installed Sable (Electron build, `%LOCALAPPDATA%\Programs\Sable`) is in daily use here. Its live profile (login tokens, secret store, sessions) is `%APPDATA%\moe.sable.client`, which is also the Tauri build's app-data folder, and in debug builds on Windows the app re-registers the `sable:` and `moe.sable.app:` URL handlers to the debug exe. The second launch attempt did exactly that; the handlers were put back by hand (`HKCU\Software\Classes\{sable,moe.sable.app}\shell\open\command`) and the installed profile was confirmed untouched. Leftovers from that run: `%LOCALAPPDATA%\moe.sable.client` (WebView2 data and logs of the dev build, safe to delete) and a `DefaultIcon` value under both handler keys pointing at the debug exe.

**Dev identity.** `src-tauri/tauri.kolpak-dev.conf.json` (new, ours) sets `productName` "Kolpak Dev", identifier `com.klpq.kolpak.dev` and the single deep-link scheme `kolpak-dev`. Run with:

```
pnpm tauri dev --config src-tauri/tauri.kolpak-dev.conf.json
```

For that to work `src-tauri/build.rs` had to change: upstream emits `cargo:rustc-env=TAURI_CONFIG={"productName": ...}`, which replaces the config the CLI passes and silently drops every `--config` override from the compiled context. It now merges `productName` into the incoming `TAURI_CONFIG`. Consequences of the dev scheme: SSO/OIDC login redirects (`moe.sable.app:/login`) will not come back to the dev build; password login is unaffected. The window title still says "Sable" (`productName` comes from the root `config.json`).

**Result.** `pnpm tauri dev` builds and runs on Windows 11. First full Rust build about 8 minutes (804 crates); an incremental rebuild of the `sable` crate 30–100 s. The window opens on the login screen (`v1.22.11-dev (7fd70f1)`, default homeserver `matrix.org`); the login page was checked at `http://localhost:8080` in a browser, the native window itself was not looked at. Data lands in `%LOCALAPPDATA%\com.klpq.kolpak.dev`.

Measured, debug build, sitting on the login screen: `sable.exe` 52 MB + six WebView2 processes 552 MB (a Vite dev page with unbundled modules, so not comparable to the SPEC §11 target; measure again on a release build). `src-tauri/target` is 15 GB after the debug build. Not measured: release build size, logged-in idle memory.

Expected noise in the log: the updater check fails (`update endpoint did not respond with a successful status code`, Sable's release endpoint), "Frontend show() not received within 5s — force-showing window" on first load, and React `forwardRef` warnings.

**Working tree after this session (nothing committed beyond the merge):** `src-tauri/Cargo.toml` and `src-tauri/build.rs` (the two fixes), `src-tauri/Cargo.lock` (codegen downgrade, package version), `src/app/generated/tauri/*.ts` (regenerated timestamp only), new `src-tauri/tauri.kolpak-dev.conf.json`, and `AI/` still untracked.

**Login, sync, send: working (same day).** The owner logged in to the first test account by hand in the Kolpak Dev window (one 403 on the first attempt, then success). Sync ran, the room the account had been invited to loaded with its timeline and 14-member list, and a test message sent from the composer came back with a server event ID. The homeserver and accounts were given in the session and are deliberately not written here.

Memory, debug build on the Vite dev server, logged in with one room open: `sable.exe` 61 MB + seven WebView2 processes about 700 MB working set (about 520 MB private). For scale, the installed Sable (Electron) on the same machine was at about 1.5 GB across eight processes, though with seven accounts. Still not a number to hold against SPEC §11; repeat on a release build.

**Driving the dev window from a script.** Screen control cannot be used on the dev build: the access grant resolves "Sable" to the installed Electron app, and the debug exe is not a Start-menu app. What works is starting the dev build with `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9333 --remote-debugging-address=127.0.0.1` set, then talking Chrome DevTools Protocol to the page whose URL starts with `http://localhost:8080` (Node 22's built-in `WebSocket` is enough; `Runtime.evaluate` to read the DOM, `Input.insertText` and `Input.dispatchKeyEvent` to type). The composer is `.ProseMirror[role=textbox]`. The port exposes the logged-in session to anything on the machine while the app runs, so use it for test accounts only.

**E2EE: the build decrypts; the test account is not set up.** In the test room some messages show "Unable to decrypt message" on the test account. Checked from inside the running app on 2026-11-25:

- The room is encrypted (`m.megolm.v1.aes-sha2`). The app's crypto engine reports "Rust SDK 0.18.0, Vodozemac 0.10.0" and decrypts every message from three of the five people who wrote, and its own messages were read by others. So decryption in this build works.
- All failures come from two senders, one Megolm session each, with reason `MEGOLM_UNKNOWN_INBOUND_SESSION_ID`: their clients never sent this device the room key. Nothing arrived to decrypt with; it is not a failure of our decrypt path.
- The test account has no cross-signing identity, no secret storage and no key backup; its one device is only locally trusted. Both failing senders have a Sable device, and the owner (one of them) was writing from the installed Sable. **Likely cause, not proven:** that client only shares room keys with devices cross-signed by their owner (the "exclude insecure devices" behaviour), so an account without cross-signing gets nothing. The senders whose messages decrypt were on clients that share with all devices.
- Kolpak itself shares with all devices: no device-isolation mode is set in the frontend, and the native engine's default strategy is `AllDevices` (`src-tauri/src/matrix_crypto/rooms.rs`).

Update, same day: the owner ran Settings → Devices → Device Verification → "Setup Device Verification" on the test account. Read back from the app afterwards: cross-signing ready, the device signed by its owner, secret storage ready, key backup version 1 active. So the setup flow works in this build. The recovery key is in `.secrets/test-account-1.txt`, which is gitignored (`.secrets/` in `.gitignore`). **Still open:** neither of the two senders had posted since the setup when this was written, so the theory is not confirmed yet.

To confirm: have one of the two senders post a new message and see whether it decrypts. Old messages will stay unreadable unless the sender's client re-shares the key. If the theory holds, Kolpak should prompt new users to set up verification right after first login, or they will see the same thing in the community's encrypted rooms.

### 2026-11-25 — rebrand, first pass (desktop)

The owner confirmed the name "Kolpak" and bundle ID `com.klpq.kolpak`. Verified in the running app: window title, custom title bar, document title, welcome page and login page say Kolpak; the test session survived; the installed Sable's link handlers and profile were not touched. 88 tests around auth, deep links, bug report and client pages pass (two test files had their scheme fixtures renamed).

Changed:

- `src-tauri/tauri.conf.json`: `productName` Kolpak, identifier `com.klpq.kolpak`, deep-link schemes `kolpak` and `io.klpq`, Sable's updater endpoint and public key removed (`endpoints: []`, `pubkey: ""`), `createUpdaterArtifacts: false`.
- `config.json`: `productName`, `homeserverList` reduced to the community homeserver (this puts the homeserver name in a committed file, which SPEC §4 requires anyway; the owner should confirm before the repo goes public), Sable's push gateway and VAPID key removed, featured communities emptied, Sable's GIF proxy and API keys removed.
- `src/app/pages/auth/SSOTauri.ts`: SSO scheme `kolpak:`, OIDC scheme `io.klpq:` with client URI `https://klpq.io`. **Assumption to confirm:** that `klpq.io` is the community's domain. The OIDC private-use scheme has to be the reverse-DNS of the client URI's host.
- Visible names and links in about 25 UI files: login, About (keeps a visible "Based on Sable (AGPL-3.0)" credit and a link to upstream), welcome page, splash, title bar, settings sentences, push display names, bug-report target (`klpq/kolpak-matrix` instead of Sable's tracker), privacy links, `index.html`, `public/manifest.json`.
- Icons: `src-tauri/icons/kolpak-icon.svg` (the Guy on a paper rounded square, built from `AI/logo.svg` per DESIGN §2.1) and `kolpak-icon-maskable.svg`; desktop bundle icons, `public/favicon.png`, `public/res/svg/logo*.svg` and the PWA PNG sets regenerated with `tauri icon`.

Now that the identifier is ours, a plain `pnpm tauri dev` no longer collides with the installed Sable. Still prefer the dev identity so that dev data stays apart from a future installed Kolpak, and build without the updater until there is a signing key and a release host:

```
pnpm tauri:wry dev --no-updater --config src-tauri/tauri.kolpak-dev.conf.json
```

(`tauri:wry` is Sable's wrapper `scripts/tauri.js`; `--no-updater` drops the Cargo feature and hides the update UI.)

Still Sable's, on purpose or pending a decision:

- **App web origin.** `getAppOrigin()` in `src/app/utils/platform.ts` returns `https://app.sable.moe` inside Tauri, so links the app generates for sharing point at Sable's hosted web app. Needs a Kolpak web origin or a different link scheme.
- **Updater.** Off. Needs a Tauri signing key (generated and kept by the owner, never in the repo) and somewhere to host releases.
- **Push.** No gateway configured, so web and mobile push are unavailable until Kolpak has its own Sygnal or UnifiedPush setup. Desktop notifications come from sync and are unaffected.
- **GIFs.** No provider keys, so GIF search returns nothing. SPEC §4 has this as TBD.
- **Theme catalog.** `themeCatalogBaseUrl` still points at `SableClient/themes` on GitHub (a public repo, no key). Works; move or disable when Kolpak has its own.
- **Internal names left alone:** the crate and binary (`sable.exe`), `package.json` name, `sable-media:` scheme, `--sable-*` CSS variables, notification action IDs, localStorage keys.
- **Smaller leftovers:** unread/highlight favicon SVGs (`public/res/svg/unread.svg`, `highlight.svg`), `public/full_res_sable*.png`, the "Sable Default" ringtone name, two permission messages in `src/app/hooks/commands/profile.ts` that mention `app.sable.moe`, `gifs.sable.moe` in `src/app/utils/klipy.ts`, `Cargo.toml` `repository`, packaging scripts and `.github/` workflows.
- **Mobile, untouched:** `sable://share` (paired with native share-extension code), `Info.plist`, `ios-project.yml`, Android project, the `moe.sable.client.*` identifiers in `tauri.pr/nightly/local.ios.conf.json`, and Sable's alternate launcher icons under `src-tauri/icons/{android,ios,app-icons}`.

**Not done yet in Spike 1:** release build size and memory; the open rebrand items above; E2EE check; other OSes and Android.

## Design log

### 2026-11-25 — Kolpak theme, first pass

Step 5 of "Next steps" was started ahead of the Mumble and stream spikes because those are blocked on server details. The Kolpak look now applies to the whole inherited UI as a built-in theme; no layout has changed yet.

- `src/kolpak/theme/kolpak-theme.css`: the DESIGN §2.3 tokens as `--kolpak-*` variables, mapped onto all of Sable's `--sable-*` variables under `.dark-theme.kolpak-theme`; then the rules variables cannot express, scoped to `.kolpak-theme`: radius 0, no shadows or blur, orange focus outline, and the header face on the folds Text heading, label and button sizes.
- `src/kolpak/theme/kolpakTheme.css.ts`: zeroes the folds radius variables through its theme contract.
- `src/kolpak/theme/index.ts`: bundles the fonts (new dependencies `@fontsource/anton`, `@fontsource-variable/oswald`, `@fontsource-variable/jetbrains-mono`) and exports the theme ID.
- Touch points in Sable's files: `src/index.tsx` (one import), `src/app/hooks/useTheme.ts` (registers `KolpakTheme`, listed first), `src/app/pages/ThemeManager.tsx` (login screens always use Kolpak instead of following the system theme), `src/app/theme/legacyToCatalogMap.ts` (`kolpak-theme` counts as built in; without this Sable shows its "Update your theme selection" migration dialog), and `config.json` → `settingsDefaults` (Kolpak is the default theme, system-theme following off). Light and Dark remain selectable, and user themes and tweaks still load on top.

Checked in the running app and by screenshot: chat view, member list, settings, a dialog and the login page. Typecheck, lint and the theme, hooks, settings and state tests pass (one ThemeManager test was rewritten for the login-screen change).

Choices made here that the design does not settle, for the owner to confirm:

- **Header font:** the stack is `Anton, Oswald, Impact`, i.e. the DESIGN §2.4 proposal (Anton for Latin, Oswald 700 for Cyrillic). Both are bundled, so switching to Oswald throughout is a one-line change.
- **Which surface is which:** Sable's "background" (room list, side panels, space rail) is `--panel`, "surface" (chat column) is `--black`. The design wants the space rail black; that needs the layout pass.
- **Warning and error colours:** both orange. The palette has no red or yellow and DESIGN §8.3 leaves error states undefined.
- **Modal overlay:** opaque black, following "no transparency". It hides the page behind dialogs completely.
- **Links:** orange.

Known gaps against DESIGN, all for the layout and component pass: selected rows are a shade lighter instead of an inverted paper block; the "new messages" divider is green where the design reserves green for voice and presence; user names keep Sable's per-user colours and fallback avatars keep pastel fills; toggles and checkboxes are only squared off, not redrawn; base text size is Sable's (16px) rather than the 14px in the mockups. The header selectors use folds' generated class names, which are stable for the pinned folds 2.7.1 and must be re-checked if folds changes.

### 2026-11-25 — layout pass 1: status bar, space rail, selection, type scale

Verified by screenshot in the running app; typecheck, lint, format and 656 tests pass (three new ones for the status bar).

- **Status bar** (DESIGN §3.5): `src/kolpak/layout/StatusBar.tsx` and `status-bar.css`, mounted from `src/app/pages/client/ClientLayout.tsx` under the whole client on desktop, hidden on mobile. 34px, paper ground, ink bold 13px. It shows a 24-hour clock and takes `streams` and `voice` props; with neither service built yet it renders "streams --" and "voice --". This is the first component written the SPEC §8 way: plain CSS in `@layer components`, with fallbacks to the active theme's colours outside the Kolpak theme.
- **Space rail** (§3.1): black with a 2px panel rule; the active item is marked by a 4×32 orange bar.
- **Selection** (§2.3): the selected room-list row is an inverted block, paper fill with bold ink text.
- **Type scale** (§2.4): `kolpakFontSize` in `src/kolpak/theme/kolpakTheme.css.ts` overrides the folds size variables: 14px body, 13px secondary, 12px meta, 11px badges, 15px section labels, 15–17px buttons.
- **Unread divider**: the "New Messages" marker in `src/app/features/room/RoomTimeline.tsx` uses the primary colour instead of success, so it is orange under Kolpak and green stays for voice and presence. This also changes it in Sable's own Light and Dark themes.

Hooks added to Sable's components so the theme has stable selectors (generated class names differ between dev and production builds): class `kolpak-space-rail` in `Sidebar.tsx`, `kolpak-rail-item` / `kolpak-rail-item-bottom` plus `data-active` in `SidebarItem.tsx`, `kolpak-nav-item` in `NavItem.tsx`. Each is a one- or two-line change.

Still open in the layout: active space tile as a paper block; two-letter Anton initials on space tiles; wordmark and "jump to" box at the top of the room list; ROOMS / PEOPLE sections as plain text rows with orange count blocks; own-avatar footer; room header at 46px; message spacing (Sable's default is looser than the mockup's 14px, and is a user setting); composer with the orange cursor; the live dock; theater mode. User names and fallback avatars still use Sable's colours.

### 2026-11-25 — layout pass 2: room list, live status bar

Verified in the running app by screenshot and by clicking through. Typecheck, lint and format pass.

- **Wordmark** (DESIGN §2.2): `src/kolpak/layout/Wordmark.tsx` replaces the "Home" title in the Home room list. "KLPQ" in Rubik Spray Paint, "Podkolpakom" in Permanent Marker, both bundled. The signature is 12px rather than the mockup's 13px so it fits beside the header's menu button.
- **"jump to" box** (§3.2): `JumpTo.tsx`, rendered under the header by `PageNavHeaderWithMenu` (Home and Direct lists). It opens Sable's existing room search and shows its shortcut. Space lists use a different header and do not have the box yet.
- **Rows** (§3.2): rooms are plain text at 30px with no icon, regular when read, bold when unread, muted colour when muted; section labels are muted. People rows keep their avatars. Unread counts are orange blocks, and `showUnreadCounts` defaults to on (`config.json` → `settingsDefaults`).
- **Status bar is live:** `ClientStatusBar.tsx` feeds it from the stream stats API through `src/kolpak/streams`. It lists every channel the API knows, on-air ones first with a dot and viewer count. Details of the API are in SPEC §6.
- **Cascade layers:** Kolpak component CSS now declares `@layer sable-reset, folds, reset, tokens, base, components, theme, user;`. Sable's two layers must be named first and in that order. Omitting them lets Sable's `button` reset beat our components (whichever stylesheet loads first fixes the order); naming them the other way round breaks folds' own buttons. Both mistakes were made and seen here.

New hooks in Sable's files: `data-kolpak-row`, `data-muted`, `data-collapsed` and class `kolpak-nav-avatar` in `RoomNavItem.tsx`; class `kolpak-unread-badge` in `UnreadBadge.tsx`; class `kolpak-nav-category` in `NavCategoryHeader.tsx`; `title` accepts a node in `PageNavHeaderWithMenu.tsx`; `streamStatsUrl` in the client config type.

**Tests.** The whole suite was run for the first time: 3,164 tests. It found five tests still expecting the word "Sable" after the rebrand (fixed), and 13 failures in `src/app/utils/mediaCache.test.ts` and `mediaTransport.test.ts` with `object.stream is not a function`. Those files and the code they test are untouched by us; the likely cause is this machine's Node 22 where the repo wants 24. Not confirmed. Everything else passes.

**Inputs received from the owner today:** the stream service source (`klpq/klpq-angular`) and the Mumble address `mumble.klpq.io:64738`. Both spikes are unblocked: SPEC §5.1 has the server version, SPEC §6 the stream API. Still unknown for Mumble: test channel, and whether a server password or registered certificates are in use.

Still open in the room list: the box on space lists; the four Home actions (Create Room and so on) that the mockup does not show; PEOPLE rows with the presence square instead of avatars; the own-avatar footer with a 2px rule; column width 222px.

### 2026-11-25 — check against the design canvas, and the stream player

**Design check.** Compared the running app with the "The client" artboard of the design canvas and fixed what differed most:

- Room header: 46px, 24px room avatar, name and topic on one line (hooks `kolpak-room-header` and `kolpak-room-header__titles` in `RoomViewHeader.tsx`).
- Composer: an outlined box with no fill, placeholder "message <room>", orange caret (class `kolpak-composer` and the placeholder in `RoomInput.tsx`).
- Home tab: the Guy on a paper square with 9px corners instead of a house icon (`HomeTab.tsx`).
- Voice tree at 13px with 1px guides per level; status bar latency as "32ms".
- The dock is open by default; closing it still persists.
- 24-hour clock is the default for new installs (`config.json` → `settingsDefaults.hour24Clock`). Existing installs keep the stored setting; this machine still shows 12-hour times until it is switched in Settings → General.

Left different on purpose, for the owner to decide:

- **Name colours.** The mockup shows plain names; the app keeps the colours people pick for themselves in Sable (profile colours and power-level tag colours). Turning them off removes a feature the community may use.
- **Timestamp position.** Sable's layout puts the time at the right edge; the mockup has it after the name. Changing it means editing Sable's message layout.
- **The four Home actions** (Create Room, Join with Address, Explore Spaces, Message Search) above ROOMS are not in the mockup; they are kept because they are the only way to those functions from the list.
- **Room-list footer.** Sable's own (avatar and three buttons) instead of the mockup's name and "on air" state line.

**Stream player** (`src/kolpak/streams/StreamDock.tsx`, `player.ts`, `streamStore.ts`). The stream half of the live dock: ON AIR (or OFF AIR) tag, a channel picker that reads as the bold channel name, a 16:9 black picture with a 2px orange frame while live, and viewers · uptime · bitrate · streamer under it. FLV is played with mpegts.js (the service's FLV comes over `wss://`), HLS with hls.js or natively on macOS and iOS; each library is loaded only when first used. mpegts.js is set to chase the live edge (at most 3 s behind). Nothing plays until the picture is clicked; volume is remembered. Clicking a live channel in the status bar picks it and opens the dock. The dock's channel defaults to the busiest live one and remembers the user's pick.

Verified in the app against the live service: channel `stream` played at 1920×1080 within about 3 seconds of the click, stats filled in. Then paused again.

Not built yet: theater mode (the same player, big, with chat beside it), the format switch, DASH, picture-in-picture beyond what the native controls offer, and the ON AIR row in the timeline.

### 2026-11-25 — theater mode

Built against the "Theater mode" artboard (DESIGN §4). WATCH in the dock (or the dock's player) opens it; EXIT THEATER closes it.

- **Layout** (`src/kolpak/theater/Theater.tsx`, mounted from `ClientLayout.tsx`): the space rail and the status bar stay; the room list, the room and the dock give way to the stream column and a 320px chat column. The routes stay mounted, only hidden, so the room and its scroll position are as they were on the way back.
- **Header** (52px): ON AIR / OFF AIR, the streamer in Anton 22, viewers · uptime · bitrate, a FLV / HLS / DASH switch (the active one a paper block; formats the channel does not offer are greyed; DASH is always greyed because it is not played), EXIT THEATER.
- **Picture** fills the column, no frame. **Channels** as chips: live with the orange dot and viewers, the selected one a paper block, offline muted "name --". **Voice line** (`theater/VoiceStrip.tsx`), one 48px row: "in voice" with a green square on the left; on the right the channel you are in as a button, then the mic and deafen buttons at 32px (`VoiceButtons size="small"`). The channel button opens the channel list upwards (indented by depth, user counts, yours inverted); picking one moves you there, Escape or a click elsewhere closes it. No list of people: the dock has the full tree. When not in voice: "not in voice" and JOIN VOICE. If the server refuses a move (a channel you may not enter), its reason shows in orange on the line for 5 s.
- **One player** (`src/kolpak/streams/sharedPlayer.ts`): a single `<video>` that both the dock and theater host. Switching views moves the element instead of reloading; checked live, playback carried on from 14.6 s to 16.1 s across the switch, same element. When no view hosts it any more (the dock closed), playback stops. Picking another channel or format while something plays switches to it; a channel going off air stops it.
- **Chat column** (`TheaterChat.tsx`): not Sable's timeline but a compact view of one room, `HH:MM name text` at 13px, names green while that person talks in voice and orange for the streamer, images and files as `[image]` / `[file]`, replies without their quoted fallback, a plain text composer. It starts on the room that was open and has a switch-room list. Checked live: 21 lines of the test room shown, Cyrillic intact.

**Images in the theater chat** (asked for by the owner): images show under their line through Sable's own image component, so encrypted and authenticated media, spoilers and the full-size viewer behave as in the timeline (checked live: five images in the test room loaded). Images are posted with the attach button, by pasting, or by dropping onto the message field; `chatImages.ts` uses Sable's encrypt, upload and image-message helpers, so posts carry size, blurhash and a thumbnail like posts from the main composer. Posting was not tried live, to keep test images out of the community room.

Not done from the design: the hamburger at the bottom of the space rail that brings back the room list (that needs a button in Sable's rail), "general 3 unread" in the status bar, GIF and emoji pickers in the theater composer, the ON AIR row in the timeline, and which Matrix room belongs to which stream (theater uses the open room; SPEC §4 has the open question). Sending from the theater composer was not tried, so as not to post into the community room.

### 2026-11-25 — "дать пососать" in the message menu

Asked for by the owner: the menu on someone else's message (Sable's message options menu, so the desktop pop-out and the mobile sheet alike) has "дать пососать", placed after "Reply in Thread". It sends what typing `/me дал пососать <name>` would: an `m.emote` whose name is a real mention (a `matrix.to` link in `formatted_body` and `m.mentions.user_ids`), so it shows as a pill and pings them. The name is the room display name, else the ID's local part, HTML-escaped in the formatted body. A message in a thread gets its reply in that thread. Hidden on our own messages, redacted ones, and in rooms we may not post in; a failed send keeps the menu open with "не отправилось. ещё раз?".

Code: `src/kolpak/chat/givePososat.ts` (content, the check, the send) and `PososatItem.tsx`; Sable's `Options.tsx` gains one import and one line. Tests: content shape, escaping, naming, when it is offered. Checked live by the owner, who sent two from the running app; they render as emotes with a mention pill.

## Spike 2 log (Mumble)

### 2026-11-25 — control connection, channel tree, dock, settings

This entry is the control channel only; sending voice came later the same day, see the next entry.

**Crate.** `crates/kolpak-mumble`, a standalone Rust crate with no Tauri in it: prost message structs written by hand against upstream `Mumble.proto` (no `protoc` at build time), framing, the server state model, TLS, and an async client that emits events. 19 unit tests, including a whole session against an in-memory server; clippy clean with warnings as errors. Build and test it alone with `CARGO_TARGET_DIR=src-tauri/target/kolpak-mumble cargo test` from the crate folder (the shared target dir keeps build output away from Vite's watcher). `cargo run --example tree -- <host>` prints a server's channel tree.

**Server facts** (`mumble.klpq.io:64738`, probed and then connected to): version 1.5.634 on Linux; self-signed "Murmur Autogenerated Certificate v2" over TLS 1.3; no server password; no client certificate required, so we join as an unregistered user; bandwidth cap 558 kbit/s; 12 channels. Control-channel ping measured at 32–37 ms.

**TLS.** The server's certificate cannot pass a web-PKI check, so the client pins it: the SHA-256 fingerprint is reported on first connect, stored (currently in `localStorage`, key `kolpak:mumble:pin:<host>:<port>`), and required to match afterwards; a changed certificate is a hard error with both fingerprints in the message. The handshake signature is still verified. Moving the pin to OS secure storage and showing a first-use prompt are still to do (SPEC §5.1).

**Bridge.** `src-tauri/src/mumble.rs` (desktop only) with commands `mumble_connect`, `mumble_disconnect`, `mumble_join_channel`, `mumble_set_self`, `mumble_get_state` and events `mumble://state`, `mumble://snapshot`, `mumble://stats`, `mumble://text`. Differences from the SPEC §5.5 sketch, now reflected there: one `mumble://snapshot` event with the whole tree instead of separate channel and user events with diffs (the tree is a dozen channels), and `mumble_get_state` so a reloaded webview can catch up. The typegen plugin maps the crate's snapshot type through `MumbleSnapshot` in `tauri.conf.json`.

**Frontend** (`src/kolpak/voice`): an event-fed store outside React and outside the Matrix stores; the VOICE half of the live dock (DESIGN §3.4) with the channel tree as a foldable outline, click a channel to move there, current channel as the inverted block, users under their channel with "(muted)" / "(deafened)", mic and deafen buttons, LEAVE; the status bar's voice entry shows channel, head count and ping and toggles the dock (open state persists). Mute and deafen follow Mumble's rules (deafening mutes, unmuting undeafens) and the buttons show what the server echoes back, never a local guess.

**Settings → Voice** (`VoiceSettingsPage.tsx`, registered as a new settings section, desktop app only): server, port, name (default: the Matrix localpart), join on startup, transmit mode (push to talk / voice activity / always on) and a push-to-talk key captured by pressing it. Stored per device in `localStorage` under `kolpak:voice:settings`, not in Sable's synced settings. **The transmit mode and the push-to-talk key are saved but do nothing yet**: there is no audio, and the key is not registered as a global hotkey. The page says so.

Checked live against the community server from the running app: join, the tree, moving between channels, mute, deafen, unmute-while-deafened, leave, and the certificate pin. We join muted and deafened because nothing is sent or played; the user can switch the icons off, which changes what others see but still sends and plays nothing.

A trap hit on the way: `VoiceSettings.tsx` next to `voiceSettings.ts` differ only in case, which TypeScript rejects and which blanked the running app through a failed hot reload. The page file is `VoiceSettingsPage.tsx`.

Next for Spike 2: UDP voice channel with the 1.5 protobuf packet format and OCB2-AES128, then receive (jitter buffer, Opus decode, playback via `cpal`), then capture and transmit, which is where the transmit mode and a global push-to-talk hotkey get wired in. Talking indicators (green names) arrive with receive.

### 2026-11-25 — sending voice, audio settings

The owner asked for working mute and deafen, then for audio settings and real transmission. Both are in. **Receiving and playing voice is still not built.**

**How voice is sent.** Microphone (`cpal`) → mono → 48 kHz → 20 ms frames → transmit gate → Opus at 40 kbit/s → a 1.5-format voice packet (one header byte `0`, then the protobuf `Audio` message with `target = 0`, a frame number counted in 10 ms units, and `is_terminator` on the last frame of a stretch) → wrapped in a `UDPTunnel` control message on the existing TLS connection. Tunnelling through TCP is the fallback path the protocol provides for clients whose UDP is blocked; using it first avoided building the OCB2-encrypted UDP channel before anything could be heard. The UDP channel is still wanted for latency and is the next transport step. Packet format checked against upstream `MumbleUDP.proto` and `MumbleProtocol.cpp`.

**Opus without a C toolchain.** This machine has no `cmake`, which the usual `opus` crate needs to build libopus. The crate uses `unsafe-libopus` 0.2 instead, libopus machine-translated to Rust: nothing to install, and nothing extra to cross-compile for Android and iOS later. It was last released in 2024; if that becomes a problem, `opus` 0.4 (needs cmake) and `ropus` are the alternatives looked at.

**In the crate** (`crates/kolpak-mumble`, feature `audio`, on by default): `voice.rs` (packets), `gate.rs` (push to talk, voice activity with a 300 ms hangover, always on; pure logic), `audio.rs` (device list, capture thread, resampler, encoder, `pump_voice`). 34 tests, clippy clean. `cargo run --example talk -- <host> [seconds]` sends the microphone for a few seconds; `-- devices` lists inputs. The resampler is linear interpolation, used only when the device is not already at 48 kHz.

**In the app.** The microphone opens when the server lets us in and closes on disconnect. It is gated by what the server says about us (self-mute, self-deafen, admin mute, suppression), by the transmit mode, and in push-to-talk mode by the key. New commands `mumble_set_transmit`, `mumble_ptt`, `audio_list_input_devices`; new events `audio://levels` and `audio://capture`. Mute and deafen follow Mumble's rules (deafening mutes, unmuting undeafens) and the UI shows the server's echo.

**Settings → Voice** now also has: microphone picker, a live input level meter that turns green while being sent, and a voice-activity threshold slider with its mark on the meter. Transmit mode and the push-to-talk key now take effect.

Verified live from the app against the community server: join, microphone opens, mute, deafen, unmute, the talking light while sending and off when muted, switching modes. Verified from the CLI: 200 frames in 4 s accepted by the server.

**Not verified: that anyone heard it.** Both tests ran in the empty Root channel, and the default input here (a SteelSeries Sonar virtual microphone) read as silence, level 0.000. A person in the channel, or the bot that transcribes Mumble into the Matrix room, has to confirm audible speech. If the level meter stays flat, pick the real microphone in Settings → Voice.

**Limits to know about:**

- **Push to talk only works while a Kolpak window has focus.** It is a key listener in the webview, not a system-wide hotkey. The global-shortcut plugin is in the app but not wired to this.
- **We still join muted and deafened**, because nothing is played back. Unmuting undeafens, which shows others a "hearing" icon although we cannot hear.
- No noise suppression, echo cancellation or automatic gain yet (SPEC §5.3).
- The certificate pin and the voice settings are in `localStorage`, not OS secure storage.

Next for Spike 2: receive and play (decode, jitter buffer, mix, output device), talking indicators for others, then the UDP channel and a global push-to-talk hotkey.

### 2026-11-25 — hearing others, the UDP channel, and the limits list

The owner asked for receive, then for "all limits" from the previous entry to be fixed. Four of the five are done; echo cancellation is not.

**Receive and playback** (`crates/kolpak-mumble/src/playback.rs`). The connection hands incoming voice packets to the caller on a separate unbounded channel, so a slow consumer cannot stall control traffic. Each speaker gets an Opus decoder and a buffer with a fixed 60 ms cushion before it starts playing and a 400 ms cap so delay cannot build up; a mixer sums the speakers, applies the output volume and clamps; a `cpal` output stream plays it, resampling when the device is not at 48 kHz. Deliberately simple: no adaptive jitter buffer, no loss concealment. Talking state comes from packets and the terminator flag, with a 350 ms timeout.

**We now join hearing, with the microphone closed** (`join_muted`), instead of muted and deafened. Deafening stops playback and drops incoming packets.

**UDP voice channel** (`crypt.rs`, `udp.rs`). OCB2 with AES-128, written against upstream's `CryptStateOCB2.cpp` including its replay window, late and lost accounting and both XEX* mitigations; it passes the two reference vectors and the every-length round trip from upstream's `TestCrypt.cpp`. The client pings over UDP every 5 s; while replies arrive, voice goes over UDP, and after 12 s without one it falls back to the tunnel through the control connection. The server's nonce resync requests are answered. A socket error on the UDP side never drops the connection.

**Noise suppression.** RNNoise through `nnnoiseless` (pure Rust) on the microphone, before the level meter and the gate, so steady room noise does not hold voice activity open. On by default, with a switch in Settings → Voice.

**System-wide push to talk, Windows only.** A registered global hotkey would swallow the key in every other app, so instead the native side reads the key's state (`GetAsyncKeyState`) every 10 ms while in push-to-talk mode. It works from any app and leaves the key alone. On other platforms there is no implementation and the webview's focused-window listener is still the only source; under Wayland this will need the portal.

**Settings → Voice** gained: output device, output volume (0–200%), output level meter, the noise suppression switch, and a line saying which path voice is using. People who are speaking are green in the dock's tree.

**Verified against the community server:**

- Two CLI clients in the Root channel: one sent 299 frames, the other received 299 voice packets, all decoded, attributed to the right sender, with the listener reporting the UDP transport. This also closes the earlier gap: sent voice does reach other clients.
- In the app: join hearing with the microphone closed, both devices open, voice path UDP.
- 57 crate tests, 5 bridge tests, the frontend suites, clippy with warnings as errors, typecheck: all pass.

**Not verified:** anyone speaking and being heard through the speakers in the app. During every observation window the people in the channel happened to be silent, and the default microphone here read as silence. The decode path is covered by a test that runs real Opus packets through the mixer.

**Still open:**

- **Echo cancellation.** Not built. It needs the played signal as a reference for the capture path and a real AEC implementation; none of the pure-Rust options was evaluated. Headset users do not need it; speaker users will echo.
- Automatic gain control.
- Adaptive jitter buffer and packet-loss concealment.
- Push to talk system-wide on macOS and Linux.
- ~~Per-user volume and local mute.~~ Done, see the next entry.
- The certificate pin and the voice settings are still in `localStorage`.

### 2026-11-25 — per-person volume and "mute for me"

Click someone else's name in the dock's voice tree: a panel opens on its own line under them (the full width of the tree, not indented, so it fits at any depth) with a volume slider, 0–200% in 5% steps, MUTE FOR ME and RESET. Only what this app plays changes; nothing goes to the server. Rows show what was set: "40%", or the name struck through with "off". Escape, a click elsewhere, or the name again closes it.

- **Stored by Mumble name**, compared without case (`src/kolpak/voice/peopleSettings.ts`, localStorage `kolpak:voice:people`), so it survives reconnects; sessions change every time. Entries back at 100% and unmuted are forgotten.
- **Applied in the native mixer** (`Mixer::set_session_gains` in `playback.rs`): a gain per session, 0 for muted. A muted speaker's buffer still drains, so unmuting resumes live instead of late. The bridge keeps the set (`mumble_set_user_gains`) and gives it to every new mixer; a new connection clears it.
- **Resent from the voice store** whenever the people on the server or the settings change, never at the level meters' rate. Each change is logged as `mumble: per-person volume [session=gain, …]`.
- The slider is styled as the house slider (`.kolpak-range`: a 2px line, paper up to the knob, square knob) for reuse elsewhere.

Checked live: joining voice sent the saved 40% for one person by their new session; MUTE FOR ME sent 0; RESET emptied the set. The first version of the panel sat inside the indented row and pushed the tree sideways (the owner caught it); now it measures exactly the tree's width. Not heard by ear: nobody was speaking during the check. Mixer tests cover the gain, the clamp, draining while muted and forgetting people who leave.

A testing trap: `window.__TAURI_INTERNALS__.invoke` is read-only, so wrapping it to record IPC calls silently does nothing. Use the log line instead.

## Starting a new Claude session on this

Open the session in a local clone of this repo and say something like:

> Read AI/HANDOFF.md, AI/FORK-NOTES.md, AI/SPEC.md and AI/DESIGN.md. We are starting Spike 1. Here are the service details: …

Give it the homeserver URL and test account in the session, not in committed files.
