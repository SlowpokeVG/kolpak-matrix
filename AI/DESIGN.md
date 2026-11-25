# Kolpak — design

Visual and interaction design for the KLPQ (Podkolpakom) client.

- Live canvas: https://claude.ai/artifact/2vCeh1gFAC6JWsTz2w59mK (private to the owner; three artboards: *Logo and style*, *The client*, *Theater mode*)
- Mockup sources: `AI/mockups/*.dc.html`. They do not render standalone (they need the canvas runtime), but every measurement and colour is in the inline styles, so treat them as the pixel reference.
- Logo: `AI/logo.svg`

Status: desktop layout and branding are drafted and close to final. Mobile has an agreed concept but no mockup. See "Open design questions" at the end.

---

## 1. The idea

One window for the three things the community already uses separately: Matrix chat, Mumble voice, and the stream service. Chat is the main surface. Streams and voice are always visible beside it, never a separate app or tab you have to go and find.

The layout is Discord-shaped because everyone already knows it, but cut down: no server discovery, no nitro-style chrome, no rounded bubbles. The look is a photocopied zine: black, paper grey, one loud orange, hard edges.

Tone of UI copy: lowercase, dry, slightly ominous. Examples already in the mockups: room topic "nothing is happening. stay.", input placeholder "message general_", and the tagline "someone left the television on in the forest. the pig knows your name. it is not telling."

## 2. Brand

### 2.1 The Guy (logo)

A hand-drawn angry guy with orange skin, blue eyes, black hair, a white-and-black headset and a boom mic.

Rules:

- Never altered: no recolouring, no cropping to a face-only mark, no simplified version. He is always drawn in full.
- On the brand sheet he is rotated −4° and passed through a slight displacement filter (`feTurbulence` baseFrequency 0.03, 2 octaves, seed 4; `feDisplacementMap` scale 3) for a hand-drawn wobble. In-app icons use the clean paths without the filter.
- App icon: the Guy on a paper (`#EDEBE4`) rounded square. Icon viewBox is `6 0 188 188` of the logo artwork (head and headset, shoulders cut by the square). Corner radius is about 20% of the side (26px at 132, 16px at 76, 9px at 40–44).
- Alternate icon ground: blue `#2B4BFF`. A third, small variant adds a 1px `#3A3A3D` border for dark docks/trays.
- In the app, the icon is the "home" button at the top of the space rail (44×44, radius 9).

### 2.2 Wordmark

- "KLPQ" in **Rubik Spray Paint**, orange `#FF4A1C`. On the brand sheet it has a hard blue `#2B4BFF` offset copy 6px right / 5px down (a misregistered print, not a shadow or glow).
- "Podkolpakom" in **Permanent Marker**, rotated −3° on the brand sheet. This is the signature and the only place the marker font is used.
- In the app sidebar: "KLPQ" at 34px orange, "Podkolpakom" at 13px beside it.

### 2.3 Colour

| Token | Hex | Use |
|---|---|---|
| `--black` | `#0B0B0C` | App ground, chat area, space rail |
| `--panel` | `#1A1A1C` | Room list, live dock, embeds, inactive chips |
| `--line` | `#3A3A3D` | Borders, dividers, tree guides |
| `--paper` | `#EDEBE4` | Primary text on dark; selected-item fill; status bar |
| `--ink` | `#111111` | Text on paper/orange/green; logo outlines |
| `--muted` | `#9A9A9E` | Secondary text, section labels, icons |
| `--dim` | `#6A6A6E` | Offline presence outline only |
| `--orange` | `#FF4A1C` | "His skin". Live, unread, primary action, cursor |
| `--blue` | `#2B4BFF` | "His eyes". Sparingly: alt icon ground, room avatar |
| `--green` | `#B6F02A` | "Mic on". Talking, online, mic-live button |
| `--video` | `#000000` | Video surface only |
| (logo white) | `#F4F4F0` | Inside the logo only |

Meaning is fixed: **orange = live or needs attention, green = voice/presence, blue = decoration**. Don't use orange for errors-only or green for "success" toasts; keep the three meanings clean.

Selection is always an inverted block: paper fill, ink text. Never a tint or a glow.

### 2.4 Type

| Face | Use | Sizes in mockups |
|---|---|---|
| **Anton** (caps) | Room/stream titles, section labels, buttons, avatar initials | 54 (brand), 22 (buttons, theater title), 20, 18 (space tiles), 17 (WATCH/LEAVE), 16 (room header), 15 (section labels, letter-spacing 0.08em) |
| **JetBrains Mono** 400/700 | Everything else: chat, lists, numbers, inputs | 14 base, 13 secondary, 12 timestamps/meta, 11 badges |
| **Permanent Marker** | "Podkolpakom" signature only | 40 / 30 / 13 |
| **Rubik Spray Paint** | "KLPQ" wordmark only | 170 / 34 |

Chat line-height 1.45. Tree line-height 1.6.

**Cyrillic (checked 2026-11-25 against the font files in the Google Fonts repo).** Anton 2.116 and Permanent Marker have no Cyrillic glyphs at all; JetBrains Mono and Rubik Spray Paint cover Russian and Ukrainian fully. Permanent Marker only ever sets the Latin word "Podkolpakom", so it is fine. Anton is not: Cyrillic room names would fall back to Impact/system.

Proposal: header stack `'Anton', 'Oswald', Impact, sans-serif` with Oswald at weight 700 bundled. Latin stays Anton; Cyrillic renders in Oswald, the closest match in weight and width of the faces tested (`AI/header-font-cyrillic.png` shows Oswald, Sofia Sans Condensed / Extra Condensed, Roboto Condensed and Yanone Kaffeesatz side by side). Alternative: use Oswald 700 for both scripts so mixed-script names look uniform. Not yet confirmed by the owner. Fonts must be bundled with the app, not loaded from Google at runtime.

### 2.5 Style rules

- Hard edges. `border-radius: 0` everywhere except the app icon and the round "live" dot.
- Solid fills only. No gradients, shadows, glows, blur or transparency.
- Borders are 2px (`--line` for structure, `--paper` for secondary buttons, `--orange` around a live video). Tree guides are 1px.
- Presence markers are 8×8 squares (filled green = online, 1px `--dim` outline = offline). The live dot is the only circle.
- Icons are 20px inline stroke SVG, stroke 2, `currentColor`, mitred joins. No emoji as UI.
- Touch/click targets: 44×44 for primary controls, 32×32 for header and composer icon buttons.

## 3. Desktop layout ("The client")

Reference frame 1200×760. CSS grid:

```
columns: 64px | 222px | minmax(0,1fr) | 290px
rows:    minmax(0,1fr) | 34px
```

```
┌────┬──────────┬────────────────────────────┬────────────┐
│ S  │ rooms    │ room header (46px)         │ ON AIR     │
│ p  │          ├────────────────────────────┤ [video]    │
│ a  │ ROOMS    │                            │ stats      │
│ c  │ PEOPLE   │ timeline                   ├────────────┤
│ e  │          │                            │ VOICE tree │
│ s  │          ├────────────────────────────┤            │
│    │ me       │ composer                   │ mic/deaf/  │
├────┴──────────┴────────────────────────────┴────────────┤
│ status bar (34px, inverted: paper ground, ink text)     │
└─────────────────────────────────────────────────────────┘
```

### 3.1 Space rail (64px, `--black`, 2px right border `--panel`)

Top to bottom, 10px gap, 12px vertical padding:

1. Home: the Guy icon, 44×44, radius 9.
2. Divider 28×2 `--line`.
3. Space tiles: 44×44 squares, two-letter Anton initials at 18px (mockup: KL, KN, DV, GM). Inactive = `--panel` fill. Active = paper fill, ink text, plus a 4×32 orange bar hanging 10px to the left of the tile.
4. Unread badge: orange block at the tile's top-right (offset −4/−4), ink mono 11px bold.
5. Bottom: "+" tile, 2px `--line` outline, muted.

### 3.2 Room list (222px, `--panel`, padding 14/16, 18px gap between blocks)

- Header: wordmark + signature.
- "jump to" box: 2px `--line` border, muted text. Quick switcher (keyboard: Ctrl/Cmd+K).
- **ROOMS** section label (Anton 15, muted). Rows are plain text, 5px vertical padding:
  - selected: paper block bleeding 8px past the text column on both sides, ink, bold
  - unread: bold + orange count block on the right
  - read: regular
  - muted/low-priority: `--muted` text
- **PEOPLE** section: DMs with the 8px presence square.
- Footer, pinned to bottom with a 2px top rule: own avatar (30×30 orange square, Anton initial), name bold, state line in muted 12px ("on air" when you are streaming).

### 3.3 Chat column

**Header** — 46px, 2px bottom border `--panel`, padding 0 22px, 12px gap:
room avatar 24×24 (solid colour + Anton initial 12px) · room name Anton 16px caps, letter-spacing 0.06em · topic in muted 13px, single line, ellipsis · right-aligned icon buttons: members (with count), pins, search.

**Timeline** — padding 18/22, 14px between messages. Message = 34×34 square avatar (solid colour, Anton initial 16) + name bold + timestamp muted 12px (24h `HH:MM`) + body. No bubbles.

- Link/video embed: `--panel` card, 8px padding, 340 wide; 112×63 black thumbnail with a play triangle; title bold; meta line muted 12px ("video · 10:00:00").
- GIFs render inline (120×68 placeholder in the theater mockup).
- **ON AIR line**: when someone in the space goes live, an inline event row appears in the timeline: ON AIR tag · streamer name bold · an orange 2px rule filling the row · "WATCH" in orange Anton 17. Clicking it opens theater mode on that stream.

**Composer** — 2px `--line` box, margin 0 22px 16px, padding 10/12. Placeholder "message <room>" followed by an orange `_` cursor. Right side: attach, GIF, sticker, emoji (32×32 each).

### 3.4 Live dock (290px, `--panel`, padding 14/18)

Top half, **stream**:
- Row: ON AIR tag left, streamer name bold right.
- Video 16:9 (143px tall at this width), black, 2px orange border while live.
- Stats row, muted 13px: three numbers. In the mockup "12 · 01:24:07 · 4,500" — intended as viewers, uptime, bitrate (kbps). Confirm against what the stream API actually exposes.

2px divider, then **VOICE**:
- Mumble channel tree as a text outline. `-` = expanded, `+` = collapsed. Each level indents 17px with a 1px `--line` guide.
- Channel rows show a user count on the right. The channel you are in is an inverted paper block.
- Users are listed under their channel. Talking = green bold. Muted = muted colour with "(muted)" suffix.
- Controls pinned to the bottom, 8px gap: mic toggle 44×44 (green fill when live), deafen 44×44 (2px paper outline), LEAVE (fills the rest, outline, Anton 17).

The dock collapses to give chat the full width; state persists.

### 3.5 Status bar (34px, full width, paper ground, ink bold 13px)

Left to right, 26px gap: clock · one entry per stream channel that is live (orange dot + name + viewer count) · offline channels in regular weight as "name --" · then, right-aligned: current voice channel + user count · latency in ms.

In theater mode it also shows unread from the room you left ("general 3 unread").

## 4. Theater mode

Grid: `64px | minmax(0,1fr) | 320px`, same 34px status bar. The room list is hidden; a hamburger button at the bottom of the space rail brings it back.

- **Header (52px)**: ON AIR tag · streamer name Anton 22 · stats · format switch `FLV / HLS / DASH` (active = paper block) · "EXIT THEATER" outline button.
- **Video**: full column width, black, no border.
- **CHANNELS strip**: one chip per stream channel. Live = orange dot + name + viewers; selected = paper block; offline = muted "name --". Mockup channels: pyro, rebel, kino, nomad, stream (placeholders until the real list is known).
- **Voice strip**: one `--panel` row: VOICE label · "server / channel" · users inline (talking in green) · mic and deafen buttons. No tree here.
- **Right column (320px)**: a chat room, compact density. One line per message: `HH:MM name text`, 13px. Name colours: green while that user is talking in voice, orange for the streamer. Header has the room name (Anton 20) and a "switch room" button. Composer has GIF and emoji only.

Default chat room for theater is the stream's chat room (mockup: stream-chat). How a stream maps to a Matrix room is an open question.

## 5. Components

| Component | Spec |
|---|---|
| Primary button | Orange fill, ink text, Anton 22, height 44, padding 0 20, no border (e.g. WATCH) |
| Secondary button | Transparent, 2px paper border, paper text, same metrics (JOIN VOICE, LEAVE, EXIT THEATER at height 32 / Anton 15) |
| ON AIR tag | Orange block, ink bold mono, 8px ink dot, padding 3–4 / 10 |
| Talking indicator | Green 8px dot + "<name> is talking" in green bold; in lists, just the name in green bold |
| Unread badge | Orange block, ink bold, padding 0 6 (0 4 on space tiles) |
| Section label | Anton 15, letter-spacing 0.08em, muted |
| Icon button | 32×32, no ground, muted icon |
| Selected row | Paper block, ink bold |

States not yet drawn: hover, focus ring, pressed, disabled, loading, error, empty room, reconnecting. Proposed defaults in keeping with the system: hover = `--panel`→`--line` fill shift or paper underline; focus = 2px orange outline, 2px offset; disabled = muted text + `--line` border.

## 6. Mobile (concept only, no mockup yet)

- Three swipeable panes: spaces+rooms ← chat → members/info.
- The live dock becomes a pull-up sheet from the bottom. Collapsed, it is the status bar (who is live, your voice channel). Half-open: voice controls and current stream thumbnail. Full: theater.
- Voice controls must stay reachable while the stream plays and while typing.
- Reference size 390×844. Targets 44px minimum.

## 7. Theming

The inherited Sable UI is themed through its `--sable-*` CSS variables, and Sable already lets users import theme and tweak CSS (see `FORK-NOTES.md`). The Kolpak look ships as the default theme on that system. New Kolpak components (dock, status bar, theater) use plain CSS with custom properties and cascade layers:

```css
@layer reset, tokens, base, components, theme, user;
```

- `tokens`: the colour/type/spacing variables in this document.
- `theme`: a named built-in theme overriding tokens.
- `user`: a user-supplied CSS file loaded last, able to override anything.

The default theme is the dark one specified here. A light ("paper") theme is plausible by swapping `--black`/`--paper`, but is not designed.

## 8. Open design questions

1. Header font for Cyrillic: confirm the Anton + Oswald stack or Oswald throughout (section 2.4).
2. Mobile mockups: panes, pull-up dock, mobile theater.
3. Unspecified states: hover/focus/disabled, empty, loading, error, reconnecting, logged-out/login screen, settings, member list, threads, reactions, replies, edits, read receipts, typing indicator, E2EE verification prompts, incoming call/voice-join prompt.
4. Whether the room header size (16px) is right; it was reduced from 22px in the last iteration and not yet confirmed.
5. Real space names, stream channel list and the meaning of the three stream stats.
6. Multiple simultaneous streams in the dock (the dock shows one; the status bar and theater strip show several).
7. Community slang and in-jokes for UI copy; language of the UI. Sable's UI strings are hardcoded English with almost no i18n, so a Russian UI is a large job; English for v1 is the cheap path.
8. Final logo asset from the owner if the SVG here is only a stand-in.
