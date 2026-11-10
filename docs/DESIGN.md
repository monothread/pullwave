# Design — the console interface

The interface of Pullwave in the style of a console's TV mode: a home screen with a hero and shelves, a menu of the sections on the left (a rail that opens), a top bar with search, downloads, sounds and a clock, libraries made of shelves and tiles, pages of a title with their cover big and blurred behind the screen, downloads shown as on a console, a focus that is seen from across the room, the arrow keys, a gamepad and short sounds to move around, and playful motion. Every theme keeps its colours, its font and its style (neon or flat). Decisions: D-126 (the layer over the themes), D-127 (the structure), D-128 (highlights and filters instead of shelves), D-129 (timing of the carousel, order of the blocks, buttons of the mouse) and D-130 (animations always on, the carousel never pauses, order by the last one seen).

## 1. Feature map (every function of the app)

The map was made from the components (`src/renderer/components`), the stores, the five catalogs of texts (`src/shared/i18n`) and the README. The redesign changes how each of these looks and how it is reached, never what it does: the backend, the IPC channels and the databases are untouched.

### Shell (every screen)
- Top bar: ☰ (opens the menu), the name PULLWAVE with its wave (glitch in the neon themes), **the search** of the libraries and of the sections, **the downloads of the whole app** (count, a line per section), **the sounds** (on/off), the chips of the programs (yt-dlp, ffmpeg, ani-cli: downloading %, WAITING, FAILED, MISSING), **the clock**.
- Menu of the sections on the left: HOME, VIDEO DOWNLOADER, ANIME (where ani-cli runs), MANGA (Linux and Windows 64-bit), SETTINGS (GLOBAL) as a gear at the bottom. A rail of pictures that widens with the names (☰, Esc closes); a dock at the bottom on a window of 760 px or less.
- **HOME** (new, the first screen): the carousel of highlights of anime and manga (what was left half way, then what got something new in the last 7 days; a welcome when there is nothing) and a big block for each section, in the order of the menu (VIDEO DOWNLOADER: what downloads and waits, PASTE A LINK, CUT; ANIME and MANGA: the news of the week and the downloads, UPDATES, LIBRARY). The carousel changes every 5 s with a soft change (the new slide comes in while the old one fades away).
- The cover of the tile with the focus, and of the page of a title, behind the whole screen.
- Banner of a new version (download, install, progress).
- Toasts: the notice of an action (info goes away after 5 s, an error stays) and the stack of finished downloads (newest on top).
- Window with the details of an error (copy, fields of the error).
- Back and forward buttons of the mouse through the visited pages, with the scroll of each page.
- **Arrow keys and gamepad** move the focus (new, see section 3).
- A screen when the bridge to the main process is missing (BridgeMissing).
- The preparation of the programs the app downloads the first time (bars, TRY AGAIN).

### Video downloader
- QUEUE: several links at once (+ ADD LINK, remove a link), a folder per link (FOLDER, back to default), OPTIONS per link (quality, container, audio only and format, subtitles, playlist, live from start, wait for live, extra arguments), AUDIO ONLY, DOWNLOAD; invalid link message.
- The download going on, big, at the top of the queue (cover or picture, bar, speed, time left, graph of the last minute, what is next), as in all three queues.
- Download cards: title, badges (custom options), states (queued, running, paused, verifying the end of a live, waiting for a live, processing, saving, merging, done, error, cancelled), progress bar of each state, speed, ETA, size, live recording time and size; PAUSE / RESUME, CANCEL, STOP & SAVE, RETRY, REMOVE, CLEAR PARTIAL FILES, SHOW FILE, the error banner with its hint and its details; CLEAR FINISHED.
- HISTORY: done and failed downloads, SHOW FILE, error title, CLEAR HISTORY (asks first).
- CUT: CHOOSE FILE or drag and drop, the picture of the file (a frame of the video, the cover of the audio or ♫), kind and length, CLEAR (asks first; off during a cut), parts to keep (start, end, ▶ to see the part in the player of the app, length, + ADD PART, remove), only the audio, CUT / CANCEL, the progress of each part, OPEN FOLDER. The player of a part plays only that part (its timeline goes from 0 to its length) and marks PREVIEW a part that had to be converted.
- SETTINGS (gear of the section): output (folder, max title length, restricted file names, delete partial files on failure), quality (max resolution, container, audio only, audio format), subtitles (playlist, write, languages, automatic, embed), live (from start, wait, verify the end and its seconds), cookies (from a browser, browser, profile, rescan), advanced (rate limit, yt-dlp path, ffmpeg path, JS runtime, extra arguments), status of the programs (versions, update), automatic save (saved / unsaved / saving / error).

### Anime
- SCHEDULE: DAY or WEEK, time zone, search in the schedule, cover cards with episode and time, today marked, add or view in library.
- SEARCH: name, SUB or DUB, results with covers (the qualifier of two results with the same title), OPEN, the next results as the list is scrolled to its end (up to 120, then it asks to make the search more specific); detail of an anime: episodes as chips, watch without downloading (stream player), ADD TO LIBRARY (series and order window) / VIEW IN LIBRARY.
- LIBRARY: the carousel of highlights, then the chips ALL / NEW (last 7 days) / ONGOING / COMPLETE (whether the releases are over), the order (recently added, last watched or A–Z) and the grid of cards of anime and series (cover, seasons, downloaded episodes, NEW EPISODE, COMPLETE), search in the library, screen of a series (no cover of its own: seasons as cards, edit series, take out of a series), screen of a season (episodes as cards: download, play, remove, watched mark, missing file mark, NO AUDIO mark, DOWNLOAD AGAIN; DOWNLOAD ALL, TRANSLATE SUBTITLES, Releases field: automatic / complete / ongoing), the gear menu of a card (series, remove).
- UPDATES: new episodes as the cards of the library (cover, title, episode and when it was found, origin and state as badges), split by day, LOOK FOR NEW EPISODES (blocked while a look goes on, with how far it is), CLEAR LIST.
- HISTORY: the anime opened or watched, as the cards of the library (cover, title, audio, episode and date, REMOVE FROM HISTORY), CLEAR HISTORY.
- DOWNLOADS (button with the count): the queue of episodes, pause, resume, cancel, retry.
- Player (downloaded or streamed): play/pause, previous and next episode (across seasons), timeline (the bar of a download), volume and mute, fullscreen with controls that hide, subtitles (choose and size in the ⚙; MANAGE SUBTITLES in the ⚙ opens a window with LOAD SUBTITLE, TRANSLATE SUBTITLE or CREATE SUBTITLE and CHECK SUBTITLES, which also shows in fullscreen; translating again replaces the translation the episode has), keyboard shortcuts (space, arrows), loading spinner, time under the mouse (right above the bar, over the mouse), where you stopped is kept.
- Windows: translate a subtitle, create a subtitle (languages, what leaves the computer, steps), add to library, confirmations.
- SETTINGS: folder and MIGRATE FOLDER, IMPORT LIBRARY, CHECK DOWNLOADED EPISODES (the audio and the files of the episodes, with DOWNLOAD AGAIN and REPAIR), quality, audio, subtitles, look for new episodes, download new ones by themselves, status of ani-cli / busybox / curl (update, use the version of the app), translation and speech providers (model, token in the keyring).

### Manga
- Setup of Suwayomi-Server (download, start), the Cloudflare helper (FlareSolverr in Docker or external) and its notices.
- BROWSE: sources of the language, popular / latest, search inside a source, FILTERS, settings of a source, infinite list of results.
- SEARCH: every source of the language at once (or every language), the state of each source, results marked in library (other source).
- LIBRARY: the carousel of highlights, then the chips ALL / NEW (last 7 days), the order (recently added, last read or A–Z) and the grid of cards, groups as tabs (create, rename, order, hide), search, series of mangas, badges of source, new chapters and a missing extension; page of a manga (chapters as cards from the lowest number, download, read, remove, read marks, CONTINUE READING, open the folder, look for new chapters, MIGRATE TO ANOTHER SOURCE / LINK SOURCE).
- Reader: single page / vertical / webtoon, direction, scale, background, gap, auto scroll and its speed, chapter select, previous and next chapter (across seasons), zones between chapters, back to the top, retry a page, download a missing page.
- UPDATES (new chapters as the cards of the library, with the chapter, when it was found, the origin and the state as badges, split by day) and HISTORY (the mangas read, as the cards of the library, with the chapter and the page it was left on, IN THE LIBRARY and REMOVE; split by day), downloads (three sources × three chapters, PAUSE ALL / RESUME ALL), EXTENSIONS (stores, install, update every extension, incompatible ones, about), SETTINGS (folder and migrate, CBZ or folder, FlareSolverr address, adult sources, language, look for new chapters, download them by themselves, the browser that opens a site, the health of the server and the helper).

### Global settings
- Appearance and window: theme (Device + 12), language (Device + 5), open on, close to tray, launch at login, start minimized.
- App updates: check now, check on start. The disclaimer link.

## 2. Design system

Style sheets, loaded in this order after `cyberpunk.css`, `themes.css` and `responsive.css`, and reading only their variables:
- `console.css`: tokens, aurora, shapes of boxes and controls, focus, motion (D-126).
- `bp-shell.css`: the grid of the screen, the top bar, the search, the downloads of the app, the menu (rail, open, dock), the cover behind the screen, the changes of page.
- `bp-home.css`: the home screen, the hero, the carousel of highlights, the blocks of the sections and the chips of the libraries.
- `bp-library.css`: the grid of tiles, the pages of a title as heroes.
- `bp-downloads.css`: the download going on and its graph; the drawn words (`.drawn`).

| Token | Value | Purpose |
|---|---|---|
| `--bp-radius` / `--bp-radius-small` / `--bp-radius-pill` | 14 / 10 / 999 px (neon: 3 / 2 px) | Corners of boxes, controls, chips and bars |
| `--bp-ease-spring` / `--bp-ease-out` | cubic-bezier | Bouncy presses and soft entrances |
| `--bp-accent-gradient` | `--cyan` → `--magenta` | Active section bar, wave of the name, logo of the flat themes |
| `--bp-focus` | `--yellow` | The focus ring |
| `--bp-shadow` / `--bp-shadow-hover` | soft depth / accent glow | Cards and tiles; none in AMOLED and high contrast |
| `--bp-aurora-*` | accents at 10–22 % | The aurora behind the screen; off in AMOLED and high contrast, pale in the light themes |

Pieces:
- **Top bar:** the wave of five bars beside the name, the clock (`TopBarClock`, `<time>`, refreshed every 5 s, in the format of the language), the chips as pills.
- **Navigation:** big labels (16 px, bold) with a picture (`SectionIcon`: download, screen with play, open book) hidden from the screen readers; the bar under the active section grows from the middle with a spring; the picture hops when pointed at and when chosen; the gear turns. On a window of 760 px or less the pictures go and the tabs keep their old size; at 520 px the wave goes too.
- **Boxes:** rounded corners, soft shadow, accent border on hover. They never keep a transform (a window fixed to the screen inside them would move into the box): they come in with opacity, or with a rise that ends with no transform.
- **Tiles of covers:** rounded cover, brighter and ringed on hover or focus, a light that sweeps over the tile. One card (`LibraryCard`, D-163) for the libraries, UPDATES and HISTORY of both sections: the cover as wide as the tile, the title under it (the button that opens the card), what is said about it, the badges and the buttons at the bottom.
- **Window of the subtitles (D-165):** the wide window (`modal--wide`) with the title and four buttons, opened from the ⚙ of the player; the backdrop covers the player and blocks the gear until it is closed.
- **Buttons:** squeeze on press; the main one has a light that runs over it every few seconds. Sizes never change (the e2e tests measure `--control-height`).
- **Focus:** 3 px ring in the focus colour, 3 px away, with a halo, breathing.
- **Motion that is fun:** aurora drifting, sound wave, sections that hop, settings and lists that rise one after the other, toasts that spring in with a burst of sparks for a finished download, windows that pop, a ring that pulses on an empty screen, the update banner that shines.
- **Always on (D-130):** the animations and the transitions run whatever the system says about motion: no style sheet has a rule for `prefers-reduced-motion` and no code looks at it.

### Words that repeat the page
The banner of a download repeats its card. Its words are drawn by the theme from `data-text` (`Drawn`) and the banner is hidden from the screen readers, so the page holds each title once for the screen readers and for a search of the text.

### Changes of page
`navigation/viewTransition.ts`: a section chosen in the menu changes the page inside a View Transition of Chromium: the page slides (`bp-page`; the helper can also fly a cover to the next page, `bp-cover`). The names exist only while `<html>` has `vt-active`. Nothing is animated only where the API is missing.

### Sounds
`sound/uiSound.ts` makes short tones with the Web Audio of the window (no files): a tick when the focus moves with the keyboard or a gamepad, a press, a falling tone to go back, a chord when the menu opens. `useUiSounds` plays them; the button of the top bar turns them off, kept in the storage of the window (`pullwave-ui-sounds`), not in the settings.

### Buttons of the mouse
Every page is in the history of the back and forward buttons (`useMouseNavigation`): the section, the screen of each section, the series and the season of the anime, the manga, the source and its settings. A change of page made of several steps is one page (`navigation/navigationBatch.ts`).

### Design improvements (D-147)
`bp-fun.css`, loaded last, and `src/renderer/fx/`. It only adds; the rules above stay. Tests: `test/renderer/theme/funLayer.test.ts` (every rule of the sheet), `test/renderer/fx/*` and `test/e2e/playful.e2e-spec.ts`.

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
- Unit: `test/renderer/theme/consoleScreens.test.ts` (the four `bp-` sheets), `test/renderer/home/*`, `test/renderer/spotlight/*`, `test/renderer/library/*`, `test/renderer/downloads/*`, and `test/renderer/theme/consoleLayer.test.ts` (tokens, no transform left on boxes, sizes of controls untouched, every animation has keyframes, no rule for less motion), the navigation modules and hooks, the clock, the icons, the tab with a picture, the App shell.
- End to end: `test/e2e/startScreen.ts` (`leaveHome`: the specs that start on the video downloader go to it from the home screen); `test/e2e/design.e2e-spec.ts`, the home screen (welcome and highlights), the open menu and the search, every screen of the video downloader and the anime section (the highlights, the chips and the order of the library, and the page of a series), in the 12 themes, at 480, 1024, 1366 and 1920 px (and, in the daily matrix and the full one, at 1080x1850 and 3440x1400), with three independent checks: geometry (nothing scrolls sideways or leaves its box, no cut text, buttons of one row the same height), alignment (top bar on one line without overlaps, the sections on one column of the rail or one row of the dock, the mark of the active section fits, the menu does not cover the page, tiles of a grid the same width) and legibility (contrast of at least 3:1 for the text of controls and labels against what is behind them); plus the arrow keys, the animations (running also when the system asks for less motion), and the colours of every theme. The audits end every animation at once while they measure (an injected style), so nothing is caught half way in. `test/e2e/layout.e2e-spec.ts` keeps auditing the rest of the screens.
- Screenshots: `docs/screenshots` (README and docs) are made again with `npm run screenshots` after a change of how a screen looks (D-144). They are made in the **Neon Tokyo** theme (`neon-tokyo-*.png`; the dark and light ones show the queue in those themes), in a virtual screen of 3440x1440 so the ultrawide one (`home-ultrawide.png`) fits; `anime-episodes.png` shows the seal of what was watched and `manga-two-pages.png` the reader with two pages.
