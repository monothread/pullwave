# Design — the console interface

The interface of Pullwave in the style of a console's TV mode: a home screen with a hero and shelves, a menu of the sections on the left (a rail that opens), a top bar with search, downloads, sounds and a clock, libraries made of shelves and tiles, pages of a title with their cover big and blurred behind the screen, downloads shown as on a console, a focus that is seen from across the room, the arrow keys, a gamepad and short sounds to move around, and playful motion. Every theme keeps its colours, its font and its style (neon or flat). Decisions: D-126 (the layer over the themes), D-127 (the structure), D-128 (highlights and filters instead of shelves), D-129 (timing of the carousel, order of the blocks, buttons of the mouse) and D-130 (animations always on, the carousel never pauses, order by the last one seen).

## 1. Feature map (every function of the app)

The map was made from the components (`src/renderer/components`), the stores, the five catalogs of texts (`src/shared/i18n`) and the README. The redesign changes how each of these looks and how it is reached, never what it does: the backend, the IPC channels and the databases are untouched.

### Shell (every screen)
- Top bar: ☰ (opens the menu), the name PULLWAVE with its wave (glitch in the neon themes), **the search** of the libraries and of the sections, **the downloads of the whole app** (count, a line per section), **the sounds** (on/off), the chips of the programs (yt-dlp, ffmpeg, ani-cli: downloading %, WAITING, FAILED, MISSING), **the clock**.
- Menu of the sections on the left: HOME, VIDEO DOWNLOADER, ANIME (where ani-cli runs), MANGA (Linux and Windows 64-bit), SETTINGS (GLOBAL) as a gear at the bottom. A rail of pictures that widens with the names (☰, Esc closes); a dock at the bottom on a window of 760 px or less.
- **HOME** (new, the first screen): the carousel of highlights of anime and manga (what was left half way, then what got something new in the last 7 days; a welcome when there is nothing) and a big block for each section, in the order of the menu (VIDEO DOWNLOADER: what downloads and waits, PASTE A LINK, TOOLS; ANIME and MANGA: the news of the week and the downloads, UPDATES, LIBRARY). The carousel changes every 5 s with a soft change (the new slide comes in while the old one fades away).
- The cover of the tile with the focus, and of the page of a title, behind the whole screen.
- Banner of a new version (download, install, progress).
- Toasts: the notice of an action (info goes away after 5 s, an error stays) and the stack of finished downloads (newest on top).
- Window with the details of an error (copy, fields of the error).
- Back and forward buttons of the mouse through the visited pages, with the scroll of each page.
- **Arrow keys and gamepad** move the focus (new, see section 3).
- A screen when the bridge to the main process is missing (BridgeMissing).
- The preparation of the programs the app downloads the first time (bars, TRY AGAIN).

### Video downloader
- QUEUE: several links at once (+ ADD LINK, remove a link), a folder per link (FOLDER, back to default), OPTIONS per link (quality, container, audio only and format, subtitles, playlist, live from start, wait for live, extra arguments), AUDIO ONLY, DOWNLOAD; invalid link and duplicate active link messages.
- The download going on, big, at the top of the queue (cover or picture, bar, speed, time left, graph of the last minute, what is next), as in all three queues.
- Download cards: title, badges (custom options), states (queued, running, paused, verifying the end of a live, waiting for a live, processing, saving, merging, done, error, cancelled), progress bar of each state, speed, ETA, size, live recording time and size; PAUSE / RESUME, CANCEL, STOP & SAVE, RETRY, REMOVE, CLEAR PARTIAL FILES, SHOW FILE, the error banner with its hint and its details; CLEAR FINISHED.
- EXPLORER: confined to the configured downloads folder and its subfolders, showing only folders, videos and audio files (hiding dotfiles and Windows `FILE_ATTRIBUTE_HIDDEN` items by default, with a persistent `Hidden` switch in the toolbar); toolbar with back/forward, UP, REFRESH, breadcrumbs starting at the downloads folder, search input, type chips (ALL / VIDEOS / AUDIO), persistent sort, `Hidden` switch and view mode, and a single OPEN FOLDER button next to the folder/video/audio count summary; cards open folders or launch the built-in `ExplorerMediaPlayer` directly on click (videos show cached FFmpeg thumbnails; media cards keep quick TO AUDIO / MERGE / CUT actions; SHOW FILE from Queue, History, Convert and Merge jumps to Explorer and highlights the file card); right-clicking a card or the background opens a zoom-aware context menu next to the mouse with New folder, Open/Play, Convert to audio, Add to merge, Cut, Rename (preserving extensions), Show in folder, Refresh and Move to trash (allowed for media files and completely empty folders, with confirmation dialog).
- HISTORY: done and failed downloads, SHOW FILE, error title, CLEAR HISTORY (asks first).
- TOOLS (`MediaToolsPanel`): unified workspace tab switching between **CUT**, **CONVERT**, and **MERGE** (keeping each tool's state across switches and displaying a running dot on background jobs):
  - CUT: CHOOSE FILE or drag and drop, the picture of the file (a frame of the video, the cover of the audio or ♫), kind and length, CLEAR (asks first; off during a cut), parts to keep (start, end, ▶ to see the part in the player of the app, length, + ADD PART, remove), only the audio, CUT / CANCEL, the progress of each part, OPEN FOLDER. The player of a part plays only that part (its timeline goes from 0 to its length) and marks PREVIEW a part that had to be converted.
  - CONVERT: CHOOSE VIDEOS or drag and drop (also fed from Explorer's TO AUDIO), audio format (`mp3`, `m4a`, `opus`, `flac`, `wav`), output destination (downloads folder, same folder as source, or custom folder), list of queued videos with duration/no-audio warning and per-item progress bar, CONVERT / CANCEL, CLEAR, SHOW FILE and OPEN FOLDER.
  - MERGE: CHOOSE VIDEOS or drag and drop (also fed from Explorer's MERGE, allowing duplicate clips), ordered list with `#1`, `#2`, ... badges and `↑` / `↓` reorder controls plus remove, total duration summary, editable output name, video container (`mp4`, `mkv`, `webm`), output destination (downloads folder, folder of the first video, or custom folder), auto fast-copy / re-encode normalization badge (`FAST COPY` / `RE-ENCODE`), progress bar, MERGE / CANCEL, CLEAR, SHOW FILE and OPEN FOLDER.
- SETTINGS (gear of the section): output (folder, max title length, restricted file names, delete partial files on failure), quality (max resolution, container, audio only, audio format), subtitles (playlist, write, languages, automatic, embed), live (from start, wait, verify the end and its seconds), cookies (from a browser, browser, profile, rescan), advanced (rate limit, yt-dlp path, ffmpeg path, JS runtime, extra arguments), status of the programs (versions, update), automatic save (saved / unsaved / saving / error).

### Anime
- SCHEDULE: DAY or WEEK (using the global time zone), search in the schedule, cover cards with episode and time, today marked, add or view in library.
- SEARCH: name, results with covers (the qualifier of two results with the same title), OPEN, the next results as the list is scrolled to its end (up to 120, then it asks to make the search more specific); detail of an anime: episodes as chips, watch without downloading (stream player), ADD TO LIBRARY (series and order window) / VIEW IN LIBRARY.
- LIBRARY: the carousel of highlights, then the chips ALL / NEW (last 7 days) / ONGOING / COMPLETE (whether the releases are over), the order (recently added, last watched or A–Z) and the grid of cards of anime and series (cover, seasons, downloaded episodes, NEW EPISODE, COMPLETE), search in the library, screen of a series (no cover of its own: seasons as cards, edit series, take out of a series), screen of a season (episodes as cards: download, play, remove, watched mark, missing file mark, NO AUDIO mark, DOWNLOAD AGAIN; DOWNLOAD ALL, TRANSLATE SUBTITLES, Releases field: automatic / complete / ongoing), the gear menu of a card (series, remove).
- UPDATES: new episodes as the cards of the library (cover, title, episode and when it was found, origin and state as badges), split by day, LOOK FOR NEW EPISODES (blocked while a look goes on, with how far it is), CLEAR LIST.
- HISTORY: the anime opened or watched, as the cards of the library (cover, title, audio, episode and date, REMOVE FROM HISTORY), CLEAR HISTORY.
- DOWNLOADS (button with the count): the queue of episodes, pause, resume, cancel, retry.
- Player (downloaded or streamed): play/pause, previous and next episode (across seasons), timeline (the bar of a download), volume and mute, fullscreen with controls that hide, subtitles (choose and size in the ⚙; MANAGE SUBTITLES in the ⚙ opens a window with LOAD SUBTITLE, TRANSLATE SUBTITLE or CREATE SUBTITLE, CHECK SUBTITLES, and DELETE with confirmation for translated tracks, which also shows in fullscreen; translating again replaces the translation the episode has), keyboard shortcuts (space, arrows), loading spinner, time under the mouse (right above the bar, over the mouse), where you stopped is kept.
- Windows: translate a subtitle, create a subtitle (languages, what leaves the computer, steps), add to library, confirmations.
- SETTINGS: folder and MIGRATE FOLDER, IMPORT LIBRARY, CHECK DOWNLOADED EPISODES (the audio and the files of the episodes, with DOWNLOAD AGAIN and REPAIR), quality, subtitles, look for new episodes, download new ones by themselves, translate downloaded episodes by themselves, status of ani-cli / busybox / curl (update, use the version of the app), translation and speech providers (model, token in the keyring).

### Manga
- Setup of Suwayomi-Server (download, start), the Cloudflare helper (FlareSolverr in Docker or external) and its notices.
- BROWSE: sources of the language, popular / latest, search inside a source, FILTERS, settings of a source, infinite list of results.
- SEARCH: every source of the language at once (or every language), the state of each source, results marked in library (other source).
- LIBRARY: the carousel of highlights, then the chips ALL / NEW (last 7 days), the order (recently added, last read or A–Z) and the grid of cards, groups as tabs (create, rename, order), IMPORT LIBRARY, search, series of mangas, badges of source, new chapters and a missing extension; page of a manga (chapters as cards from the lowest number, download, read, remove, read marks, CONTINUE READING, open the folder, look for new chapters, MIGRATE TO ANOTHER SOURCE / LINK SOURCE).
- Reader: single page / vertical / webtoon (a column of at most 938 px in the middle, D-190, D-191), direction, scale, background, gap, auto scroll and its speed, chapter select, previous and next chapter (across seasons), zones between chapters, back to the top, retry a page, download a missing page.
- UPDATES (new chapters as the cards of the library, with the chapter, when it was found, the origin and the state as badges, split by day) and HISTORY (the mangas read, as the cards of the library, with the chapter and the page it was left on, IN THE LIBRARY and REMOVE; split by day), downloads (three sources × three chapters, PAUSE ALL / RESUME ALL), EXTENSIONS (stores, install, update every extension, incompatible ones, about), SETTINGS (folder and migrate, CBZ or folder, FlareSolverr address, adult sources, language, look for new chapters, download them by themselves, the browser that opens a site, the health of the server and the helper).

### Global settings
- Appearance and window: theme mode (System / Dark / Light) and 19 theme families (38 themes total), **Performance mode** (off by default, `Settings.performanceMode`, D-213), language (Device + 5), time zone (Device + IANA zones, applied to all dates and times across the app), the volume of the sounds, close to tray, launch at login, start minimized.
- App updates: check now, check on start. The disclaimer link.

## 2. Design system

Style sheets, loaded in this order after `cyberpunk.css`, `themes.css` and `responsive.css`, and reading only their variables:
- `console.css`: tokens, aurora, shapes of boxes and controls, focus, motion (D-126).
- `bp-shell.css`: the grid of the screen, the top bar, the search, the downloads of the app, the menu (rail, open, dock), the cover behind the screen, the changes of page.
- `bp-home.css`: the home screen, the hero, the carousel of highlights, the blocks of the sections and the chips of the libraries.
- `bp-library.css`: the grid of tiles, the pages of a title as heroes.
- `bp-downloads.css`: the download going on and its graph; the drawn words (`.drawn`).
- `bp-fun.css`: the playful motion and FX layer (D-147).
- `performance.css`: loaded last; `:root[data-performance-mode]` overrides that preserve layout and theme fidelity while removing GPU/CPU-heavy animations, blurs, and glow filters when Performance mode is enabled (D-213).

| Token | Value | Purpose |
|---|---|---|
| `--bp-radius` / `--bp-radius-small` / `--bp-radius-pill` | 14 / 10 / 999 px (neon: 3 / 2 px) | Corners of boxes, controls, chips and bars |
| `--bp-ease-spring` / `--bp-ease-out` | cubic-bezier | Bouncy presses and soft entrances |
| `--bp-accent-gradient` | `--cyan` → `--magenta` | Active section bar, wave of the name, logo of the flat themes |
| `--bp-focus` | `--yellow` | The focus ring |
| `--bp-shadow` / `--bp-shadow-hover` | soft depth / accent glow | Cards and tiles; none in AMOLED and high contrast |
| `--bp-aurora-*` | accents at 10–22 % | The aurora behind the screen; off in AMOLED and high contrast, pale in the light themes |

Pieces:
- **Top bar:** the wave of five bars beside the name, the clock (`TopBarClock`, `<time>`, refreshed every 5 s, in the format of the language and configured time zone), the chips as pills.
- **Navigation:** big labels (16 px, bold) with a picture (`SectionIcon`: download, screen with play, open book) hidden from the screen readers; the bar under the active section grows from the middle with a spring; the picture hops when pointed at and when chosen; the gear turns. On a window of 760 px or less the pictures go and the tabs keep their old size; at 520 px the wave goes too.
- **Boxes:** rounded corners, soft shadow, accent border on hover. They never keep a transform (a window fixed to the screen inside them would move into the box): they come in with opacity, or with a rise that ends with no transform.
- **Tiles of covers:** rounded cover, brighter and ringed on hover or focus, a light that sweeps over the tile. One card (`LibraryCard`, D-163) for the libraries, UPDATES and HISTORY of both sections: the cover as wide as the tile, the title under it (the button that opens the card), what is said about it, the badges and the buttons at the bottom.
- **Window of the subtitles (D-165):** the wide window (`modal--wide`) with the title and four buttons, opened from the ⚙ of the player; the backdrop covers the player and blocks the gear until it is closed.
- **Window of the library mangas of an extension (D-212):** opened from the count beside INSTALLED (a small button, disabled at 0); `modal--library` is as wide as the content of the app (`--app-max`) and as tall as the window allows, and its grid of library cards (`modal__grid`) fills the columns like the library and scrolls inside, with room around the cards so the cover that grows under the mouse or the focus never makes a sideways scroll.
- **Buttons:** squeeze on press; the main one has a light that runs over it every few seconds. Sizes never change (the e2e tests measure `--control-height`).
- **Focus:** 3 px ring in the focus colour, 3 px away, with a halo, breathing.
- **Motion that is fun:** aurora drifting, sound wave, sections that hop, settings and lists that rise one after the other, toasts that spring in with a burst of sparks for a finished download, windows that pop, a ring that pulses on an empty screen and a lens that sweeps, shakes no and shows a red cross when a search or a filter finds nothing (smaller in windows and dropdowns), the update banner that shines.
- **Always on by default (D-130, D-213):** animations and transitions never inspect OS `prefers-reduced-motion` (no style sheet has a `prefers-reduced-motion` rule and no code reads it). Instead, users who need lower CPU/GPU consumption turn on the opt-in **Performance mode** switch in global settings (`Settings.performanceMode`, default `false`).

### Words that repeat the page
The banner of a download repeats its card. Its words are drawn by the theme from `data-text` (`Drawn`) and the banner is hidden from the screen readers, so the page holds each title once for the screen readers and for a search of the text.

### Changes of page
`navigation/viewTransition.ts`: a section chosen in the menu changes the page inside a View Transition of Chromium: the page slides (`bp-page`; the helper can also fly a cover to the next page, `bp-cover`). The names exist only while `<html>` has `vt-active`. Nothing is animated only where the API is missing.

### Sounds
`sound/uiSound.ts` makes short tones with the Web Audio of the window (no files): a tick when the focus moves with the keyboard or a gamepad, a press, a falling tone to go back, a chord when the menu opens (`useUiSounds`), and the sounds of events: a finished or failed download (`FxLayer`), a cover added to a library (`flyCover`), a page turned in the reader, a switch. The button of the top bar turns them off and the global settings set their volume, both kept in the storage of the window (`pullwave-ui-sounds`, `pullwave-ui-volume`), not in the settings file.

### Buttons of the mouse
Every page is in the history of the back and forward buttons (`useMouseNavigation`): the section, the screen of each section (including Explorer and Tools modes: Cut, Convert and Merge), the series and the season of the anime, the manga, the source and its settings; the back button also closes active overlays such as the anime player, the manga reader, the cut preview player and the explorer media player. A change of page made of several steps is one page (`navigation/navigationBatch.ts`).

### Design improvements (D-147)
`bp-fun.css`, loaded last before `performance.css`, and `src/renderer/fx/`. It only adds; the rules above stay. Tests: `test/renderer/theme/funLayer.test.ts` (every rule of the sheet), `test/renderer/fx/*` and `test/e2e/playful.e2e-spec.ts`.

### Dual-mode design contract: Normal mode vs. Performance mode (D-213)
Every UI or design change in Pullwave must be designed, implemented, and tested for **both modes**:
- **Normal mode (`performanceMode: false`, default):** all visual features, animations, transitions, blurs, glows, particles, and decorative loops enabled.
- **Performance mode (`performanceMode: true`, `<html data-performance-mode>`):** preserves the exact layout, typography, colors, theme identity, and interactive feedback while removing hardware-heavy rendering and runtime loops:
  - **CSS (`src/renderer/theme/performance.css`, loaded last):** add `:root[data-performance-mode]` overrides for any new infinite/ambient animation, `backdrop-filter`, expensive `filter`/`drop-shadow`, large multi-layer glow shadow, or heavy transition. Provide readable solid/translucent fallbacks and never break terminal/interactive states (such as completed states, progress bar widths, focus rings, or overlays).
  - **JS/React (`usePerformanceMode()` / `isPerformanceModeActive()`):** bypass decorative `requestAnimationFrame` loops, parallax/3D tilt, ripples, sparks/confetti, animated counters, flying covers, and View Transitions while still rendering the final state immediately.
  - **Runtime switching (`OFF → ON → OFF`):** switching the toggle live must cleanly unmount/reset active visual state and inline styles without requiring a restart, and restore full Normal mode behavior when turned off.

### Screens that are not 1920x1080 (D-153)
- **Ultrawide (3440x1440):** the page grows to 2400 px from a 2200 px window; from 2200x1300 the interface is magnified a fifth (`--ui-zoom`, `zoom` on `<html>`), and the units of the screen (`vh`, `vw`) are divided by it. From 1700 px of page: three columns in the lists, the history and the settings, tiles of 200 px; the home stays in one column as wide as the page. A 2560x1080 screen gets the width and the columns, not the magnification.
- **Turned to stand up (1080x1920):** the top bar on one line from 1000 px (its start and its end never get less than their content); in a portrait window taller than 1200 px the hero grows with the height and the blocks of the sections are one on each row.

### What was watched or read (D-154)
`WatchedMark`: a solid green pill with a ✓ and the word, in the cards of the episodes and of the chapters. What is yet to be watched or read has a cyan top edge and a bold name; what was has a green edge, a tint, a grey name and the seal. The colour of the name is the muted one (no opacity), so the contrast of the audits holds.

### Reader: two pages side by side (D-155)
The `twoPages` setting of the single page mode: pairs 1+2, 3+4 (only the last page alone, whatever the shape of the pages), the first page on the side the direction says.

### Reader: clicks, fullscreen, settings (D-156)
Clicks on the stage (`readerClickZones.ts`): the sides turn the page (40% each with one page, the 25% corners with two), the strip from 40% to 60% takes the double click of the fullscreen and turns nothing; the scroll modes keep the double click anywhere. The settings of the reader close with a click outside them. Three pages after the ones on screen are loaded and decoded ahead. Each manga keeps its own settings (`pullwave.manga.readerByManga`), and the ones chosen last start a manga that has none.

## 3. Navigation like a console
- `src/renderer/navigation/spatialNavigation.ts`: the next control in a direction (distance along the direction plus three times the distance across), the scope (an open modal window, else the app), the controls that count (buttons, links, summaries, role button, tabindex; never fields), the screens that keep the arrows (`.player`, `.reader`).
- `useSpatialNavigation`: the arrows move the focus while a control has it; a field, the player and the reader keep their arrows.
- `src/renderer/navigation/gamepad.ts` + `useGamepadNavigation`: the gamepads are read only while one is connected; directional pad or left stick move, **A** presses, **B** closes a window (Esc) or goes back (the back button of the mouse, which also closes the player and the reader), **LB / RB** change the section (`navigation/sections.ts`, going round). In the player and the reader the directions are sent as the arrow keys.

## 4. How the design is verified
- Unit: `test/renderer/theme/consoleScreens.test.ts` (the four `bp-` sheets), `test/renderer/theme/performanceMode.test.ts` (every `:root[data-performance-mode]` selector and helper behavior), `test/renderer/home/*`, `test/renderer/spotlight/*`, `test/renderer/library/*`, `test/renderer/downloads/*`, and `test/renderer/theme/consoleLayer.test.ts` (tokens, no transform left on boxes, sizes of controls untouched, every animation has keyframes, no rule for less motion), the navigation modules and hooks, the clock, the icons, the tab with a picture, the App shell.
- End to end: `test/e2e/startScreen.ts` (`leaveHome`: the specs that start on the video downloader go to it from the home screen); `test/e2e/performance-mode.e2e-spec.ts` (Performance mode off by default, disabling heavy effects and loops when enabled, persisting across restarts, and cleanly restoring Normal mode when turned off); `test/e2e/design.e2e-spec.ts`, the home screen (welcome and highlights), the open menu and the search, every screen of the video downloader and the anime section (the highlights, the chips and the order of the library, and the page of a series): day to day in cyberpunk, light and synthwave at 480 and 1366 px and in cyberpunk and light at 1080x1850 and 3440x1400; in the full matrix (`@full`) in every theme at 480, 1024, 1366 and 1920 px, 1080x1850 and 3440x1400; with three independent checks: geometry (nothing scrolls sideways or leaves its box, no cut text, buttons of one row the same height), alignment (top bar on one line without overlaps, the sections on one column of the rail or one row of the dock, the mark of the active section fits, the menu does not cover the page, tiles of a grid the same width) and legibility (contrast of at least 3:1 for the text of controls and labels against what is behind them); plus the arrow keys, the animations (running also when the system asks for less motion), and the colours of every theme. The audits end every animation at once while they measure (an injected style), so nothing is caught half way in. `test/e2e/layout.e2e-spec.ts` keeps auditing the rest of the screens.
- Screenshots: `docs/screenshots` (README and docs) are made again with `npm run screenshots` after a change of how a screen looks (D-144). They are made in the **Neon Tokyo** theme (`neon-tokyo-*.png`; the dark and light ones show the queue in those themes), in a virtual screen of 3440x1440 so the ultrawide one (`home-ultrawide.png`) fits; `anime-episodes.png` shows the seal of what was watched and `manga-two-pages.png` the reader with two pages.
