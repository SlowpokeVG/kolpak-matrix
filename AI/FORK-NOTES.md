# Kolpak — fork notes (Sable)

Read on 2026-11-25 from `SableClient/Sable`, default branch, commit `3adfe1e` (2026-10-16), version 1.22.11. These are facts from the code, replacing the "from memory" guesses in SPEC.md §2. Re-check versions when the fork is actually made.

> **Update 2026-11-25, after the merge.** The commit these notes were read from (`3adfe1e`) is the one that renames the project "Sable Legacy" and declares it unmaintained; development moved to a rewrite at `git.sable.moe/SableClient/Sable-next`. "Upstream moves fast" below no longer holds. The tag `v1.22.11` is `98416a9` and needs two fixes to build and run safely on Windows. A plain `pnpm tauri dev` must not be used on the dev machine. Details and the working command are in `HANDOFF.md` → "Spike 1 log".

## What Sable is

| | |
|---|---|
| Repo | https://github.com/SableClient/Sable (fork of Cinny) |
| Licence | AGPL-3.0-only (`package.json`); Rust crate AGPL-3.0-or-later |
| Trademarks | `TRADEMARKS.md` explicitly allows forks to strip the branding and replace it. Logo is CC0 |
| Frontend | React 19, TypeScript 7, Vite 8, pnpm 11, Node ^24.18 |
| Matrix | matrix-js-sdk 42.3.0, crypto via matrix-sdk-crypto-wasm; optional native Rust crypto engine (`matrix-crypto` feature, matrix-sdk 0.18) |
| State | jotai, TanStack Query |
| UI kit | `folds` 2.7.1 (Apache-2.0) + vanilla-extract. 104 `*.css.ts` files, ~510 files import `folds` |
| Shell | **Tauri 2.11 already in the repo** (`src-tauri/`, ~12.6k lines of Rust), pinned Rust 1.97.1 |
| Targets | Windows (NSIS + MSI), macOS, Linux (wry or CEF runtime), Android, iOS, all from one CI workflow |
| Size | ~650 `.tsx` + ~1000 `.ts` files |

## What it already has that the spec planned to build

- Tauri desktop shell: tray with badge, single instance, window state, deep links, auto-updater, native notifications.
- `tauri-plugin-global-shortcut` is already wired in. Global push-to-talk can hang off it.
- A custom `sable-media:` URI scheme and a Rust network layer for media.
- GIF picker with Tenor / Klipy / Giphy through a proxy (`config.json` → `gifs`). The keys and proxy there are Sable's; we need our own or a different source.
- **User themes and "tweaks"**: themes are plain CSS files that set `--sable-*` custom properties on `.light-theme` / `.dark-theme`; users can import a theme or a tweak CSS by URL, upload or paste, from a remote catalog (`themeCatalogBaseUrl`). See `src/app/styles/themes.css` and `src/app/theme/`.
- Mobile: Android and iOS builds, push (Sygnal / UnifiedPush), CallKit on iOS, share extension.
- Calls: Element Call / LiveKit (MatrixRTC). Not wanted for Kolpak (voice is Mumble). `elementCallUrl` is `null` by default; hide the call UI rather than rip the code out, to keep merges cheap.

## What this changes in our plan

1. **Spike 1 shrinks** to: fork with history, build unmodified, log in, then rebrand. No Tauri integration work.
2. **Theming decision (was open in SPEC §2):** do not replace the styling system. Kolpak's look ships as a built-in theme that maps our tokens onto `--sable-*`, plus a `kolpak` CSS layer for what tokens cannot reach (radius 0, borders, fonts, no shadows). The community-theming goal is already met by Sable's theme/tweak import. `@layer reset, tokens, base, components, theme, user` from SPEC §8 applies to **our new components only** (dock, status bar, theater).
3. **Layout is the real frontend work.** Space rail and room list exist (`src/app/pages/client/SidebarNav.tsx`, `sidebar/`), so the design is a restyle of those plus three new pieces: live dock, status bar, theater. New code lives in `src/kolpak/`; the touch points in Sable's files should be as few as possible (ideally `ClientLayout.tsx` and the router).
4. **Mumble goes in as its own Rust module** under `src-tauri/src/mumble/` with its own commands, registered in `lib.rs`. One merge-conflict point.
5. **Telemetry:** Sable ships Sentry, but it is off unless a DSN is set at build time, and opt-in for users even then. We build without a DSN. "No telemetry" in SPEC §10 holds with no code change.
6. **Config to replace before any build we hand out** (`config.json`, `tauri.conf.json`): product name, identifier `moe.sable.client`, homeserver list, push gateway (`sygnal.sable.moe`), theme catalog URL, featured communities, GIF keys/proxy, updater endpoint **and updater public key**, deep-link schemes. Shipping Sable's updater key would let Sable's releases replace ours.

## Costs and risks found

- **Upstream moves fast.** Six 1.22.x releases in September 2026 alone. Plan a regular merge from upstream and keep our diff in few files.
- **i18n is nearly empty.** `public/locales/` has `en.json` and `de.json` at ~100 bytes each; UI strings are hardcoded English. A Russian UI means wiring strings through i18next ourselves (large, conflicts with every upstream merge) or living with English chrome. Recommendation: English UI for v1.
- **Upstream contribution policy.** Sable's `CLAUDE.md`/`AGENTS.md` tell AI agents never to open issues or PRs there. Anything we send upstream goes through a human, by hand.
- **Linux codecs** are already handled by package dependencies on GStreamer plugins, and there is a CEF (Chromium) runtime option. That lowers the stream-playback risk on Linux noted in SPEC §6.
- **Mobile calls plugin** (`tauri-plugin-livekit-mobile`) is where Sable handles call audio on Android/iOS. Read it before Spike 4 to see how it deals with background audio; I have not read it yet.

## Build check (Linux, cloud workspace)

- `pnpm install` then `pnpm build` (Vite) succeeds: 546 files, 77 MB `dist/` (50 MB of it `assets/`, includes fonts, emoji, PDF and syntax-highlighting bundles). Build takes about 70 s.
- Ran on Node 22 although the repo asks for ^24.18; use 24 on the dev machine.
- One dev dependency (`tauri-plugin-app-icon-api`, a GitHub tarball used only for generating mobile launcher icons) could not be downloaded in the cloud workspace and was left out for this check. It should install normally on the dev machine.
- **Not done:** the Tauri/Rust build, any Windows build, running the app, logging in. Those need the dev machine.

## Dev machine prerequisites (Windows)

From Sable's `mise.toml`:

- Node 24, pnpm 11 (via corepack), Rust 1.97.1 (rustup reads `rust-toolchain.toml`)
- Visual Studio Build Tools with the C++ workload and Windows 11 SDK
- WebView2 runtime (preinstalled on Windows 11)

## Commands for Spike 1 (run in `F:\Projects\kolpak-matrix`)

The repo currently has one commit (README). Bringing in Sable with history:

```
git remote add upstream https://github.com/SableClient/Sable.git
git fetch upstream
git checkout -b sable-base v1.22.11          # latest release tag; or upstream/dev
git checkout main
git merge sable-base --allow-unrelated-histories
```

Resolve the README conflict by keeping ours, keep `AI/` as is, then:

```
corepack enable
pnpm install
pnpm tauri dev
```

Decide `dev` versus the latest release tag when doing it; the release tag is the safer base.
