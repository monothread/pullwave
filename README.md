# PULLWAVE — video downloader and anime player for Linux and Windows

Pullwave is a desktop app with a cyberpunk look (and light and dark themes too) for downloading videos and for keeping and watching anime. It has two parts, side by side:

- **Video downloader:** download videos and audio from the sites [yt-dlp](https://github.com/yt-dlp/yt-dlp) supports, with a queue, a history and live-stream recording.
- **Anime:** search, download, a library of your own and a player, built on [ani-cli](https://github.com/pystardust/ani-cli). On Linux and on Windows 10 (version 1903) or newer.

There is nothing else to install: everything the app needs comes with it.

> **Disclaimer:** every download made with this program is **at the user's own risk and responsibility**. The authors and contributors are not responsible for what is downloaded or for how it is used. You must only download content you have the right to download. See [DISCLAIMER.md](DISCLAIMER.md).

| Cyberpunk | Dark | Light |
|---|---|---|
| ![Cyberpunk theme](docs/screenshots/cyberpunk-downloads.png) | ![Dark theme](docs/screenshots/dark-downloads.png) | ![Light theme](docs/screenshots/light-downloads.png) |

## Highlights
- Choose the quality, the format and the subtitles of each download, or download only the audio.
- Record **live streams**, wait for scheduled ones and keep the file even if the stream drops.
- **Find stream:** when a page is not supported, the app looks for the video in it and lets you pick one.
- An **anime library** of your own, with series and seasons, where you stopped watching and subtitles in every language the source offers.
- A **player** inside the app, or watch an episode **without downloading** it.
- The whole app in **English, Português, Español, 中文 and 日本語**.
- Updates itself, and updates its video and anime tools from inside the app.

## Install
Download the file for your system from the [Releases page](https://github.com/monothread/pullwave/releases/latest).

| System | File |
|---|---|
| Windows 10/11 (64-bit) | `pullwave-x.y.z-setup.exe` |
| Ubuntu, Debian and derivatives | `pullwave-x.y.z.deb` |
| Fedora (and other RPM-based distributions) | `pullwave-x.y.z.rpm` |
| Arch Linux (and derivatives) | `pullwave-x.y.z.pacman` |
| Any other Linux | `pullwave-x.y.z.AppImage` (portable, installs nothing) |

**Windows** — run the setup file. It installs for your user only and creates the shortcuts. The installer is not code-signed, so Windows SmartScreen may show "Windows protected your PC": choose *More info* → *Run anyway*.

**Ubuntu / Debian** — double-click the `.deb` or run `sudo apt install ./pullwave-x.y.z.deb`.

**Fedora** — `sudo dnf install ./pullwave-x.y.z.rpm`

**Arch Linux** — `sudo pacman -U ./pullwave-x.y.z.pacman`

**AppImage** — allow it to run, then open it:
```bash
chmod +x pullwave-x.y.z.AppImage
./pullwave-x.y.z.AppImage
```
Ubuntu 22.04 and newer need FUSE 2 for AppImages (`sudo apt install libfuse2`, or `libfuse2t64` on Ubuntu 24.04). If it does not open on Ubuntu 24.04, run it with `--no-sandbox`; the `.deb` does not have this problem.

Once installed, the app looks for new versions by itself (the ⚙ of the top bar, APP UPDATES): one click downloads the update and another restarts into it.

## Getting around
The top bar has **VIDEO DOWNLOADER**, **ANIME** and a ⚙ for the settings of the whole app. Each part has its own bar and its own ⚙:

| Part | Screens |
|---|---|
| VIDEO DOWNLOADER | QUEUE · HISTORY · ⚙ |
| ANIME | SCHEDULE · SEARCH · LIBRARY · HISTORY · ⚙ (and a DOWNLOADS button) |

The back and forward buttons of the mouse take you through the screens you have been to.

## Video downloader
![The queue downloading](docs/screenshots/cyberpunk-downloads.png)

### Queue
- Paste a link, or several: **+ ADD LINK** gives you one field per link. **FOLDER** sends that download to another folder, and **OPTIONS** changes the quality, the format and the live-stream behavior for that download only.
- Every download shows its progress, speed and time left, and can be paused, resumed, cancelled or retried. Up to two downloads run at the same time, the others wait their turn. When one finishes you get a notice, and it moves to the history.
- **PAUSE** stops a download and keeps what was already downloaded; **RESUME** goes on from there, and a paused download leaves its place in the queue to the next one. A live recording cannot be paused (STOP & SAVE ends it). A paused download is still there, paused, when you open the app again, and RESUME goes on from its partial files (a download that needed the cookie of a page may have to be found again with FIND STREAM). Closing the app while downloads are running cancels them and deletes their unfinished files (paused downloads are kept, with theirs); the app asks before it does.
- If something goes wrong, a clear message explains what happened, with the details one click away.

  ![An error explained in the queue](docs/screenshots/cyberpunk-error.png)

- Failed or cancelled downloads clean up after themselves; live recordings are always kept.

### History
![History of the video downloader](docs/screenshots/cyberpunk-history.png)

Every download, finished or failed, with the time and a button to show the file.

### Quality, audio and subtitles
- The best video and audio available, up to the maximum resolution you choose, as mp4, mkv or webm.
- **Audio only** as mp3, m4a or opus.
- Playlists, and subtitles in the languages you choose, including YouTube's automatic captions. Subtitles can be embedded in the video, leaving a single file.
- A limit on the length of file names, and an option to keep them plain ASCII.

### Videos that need a login
Use the cookies of your browser for age-restricted, private or members-only videos. The browsers installed on your computer, and their profiles, are found automatically; **RESCAN BROWSERS** looks again after you install one.

### Live streams
- Record a live from the start (when the broadcaster allows it), or wait for a scheduled live to begin.
- **STOP & SAVE** ends the recording and keeps the file. The card shows how long it has been recording and how big the file is.
- If the stream drops, the app keeps looking for it for a few seconds. If it comes back, the recording goes on in a new file of the same download.

### Find stream
When a link does not work because the page is not supported (for example "Unsupported URL"), the card offers **FIND STREAM**. The app looks for the video in the page, and, if it finds nothing, opens the page in a hidden window for a short while to see what it loads. Then you pick one of the videos found, and it is downloaded like any other link.

- Videos protected by DRM cannot be downloaded, and pages that need a login may show nothing.
- The site sees a visit to the page, as with any browser.
- Use it only for content you have the right to download; see [DISCLAIMER.md](DISCLAIMER.md).

### Settings of the video downloader (⚙)
![Settings of the video downloader](docs/screenshots/cyberpunk-settings.png)

Where downloads are saved and how files are named, quality and format, playlists and subtitles, live streams, browser cookies, and advanced options such as a speed limit or using your own yt-dlp and ffmpeg. **UPDATE YT-DLP** brings the download tool up to date without waiting for a new version of the app: it only installs a release whose list of checksums is signed by the yt-dlp project (the signature is checked with the key of the project that comes with the app), and it runs the new one before it replaces the old one. If the updated one turns out worse, **USE THE ONE THAT SHIPS WITH THE APP** deletes it; the app also drops an updated one by itself when it is older than the one that comes with a newer version of the app, or when it no longer runs.

## Anime
Pullwave includes [ani-cli](https://github.com/pystardust/ani-cli) and everything it needs, so the anime section works as soon as the app is installed.

### Schedule
The first tab of ANIME shows the episodes that air, as [AniList](https://anilist.co) schedules them, as cards with the cover of each anime, in the order they air, at the time of the time zone you pick (the one of your computer to begin with). The schedule always opens on the DAY view; the time zone you pick is remembered. The search field above the cards narrows what is listed to the anime whose name (or another name AniList knows it by) has what you typed, and each card then shows the date and the time its episode airs; it looks only at the day or the week that is listed.

- **VIEW** switches between **DAY** (today) and **WEEK** (the seven days that start with today, one section for each day).
- **TIME ZONE** decides where each day starts and the time shown on the cards.
- Click a card to go to the **SEARCH** tab, which looks the anime up by its name (and by its other names, if the first finds nothing); from there you choose the anime and download its episodes as usual.

What AniList says is kept for a day, so showing the same day again (or a day of a week you already looked at) does not ask it again, and it is still there when you open the app again; **REFRESH** asks again. The anime of the day are also looked up in the source, in the background (and when the app starts), by their english name and then by their romaji one: a card whose title is found there says **AVAILABLE**, and clicking it opens the search by the name that found it (the english one when both did); one the source does not have is faded, says **NOT AVAILABLE** and cannot be clicked; while it is being checked a card says CHECKING…, and one that could not be checked (no network, for instance) is shown as before. What is found is kept for an hour. Only the day that is shown is checked (the week is checked when you pick it).

### Search and download
![Search](docs/screenshots/anime-search.png)

- **Search** an anime, subtitled or dubbed, and click a result to see its episodes.
- **ADD TO LIBRARY** opens a window that explains the **series** (the group the anime belongs to, such as all the seasons of the same show) and the **order** (the place of the season in the series; an order the series already uses is not allowed, and the window says which one is next) and asks you to confirm. It then puts the anime in the library with all its episodes, without downloading anything (once added, the search only says the series). It is then replaced by VIEW IN LIBRARY. Downloads are asked for in the library. The DOWNLOADS button at the top shows how many are running or waiting and opens the list, where each download can be **paused** and resumed. A finished download leaves the list and is announced by a toast; toasts stack, newest on top, and each goes away after 5 seconds.
- **Covers:** every anime in the search, the library, the history and the schedule has its cover, found at AniList by the title (a block that says COVER NOT FOUND shows when there is none). Covers are kept on your computer and checked again the first time each day.
- **Watch without downloading:** click an episode and the player opens.

### Library
![Library](docs/screenshots/anime-library.png)

Everything you downloaded, with sizes, where you stopped watching and what failed. Each episode is kept with its subtitles.

- The library shows one card per series. Click it to open the series.
- An episode that is not downloaded shows as NOT DOWNLOADED, with a DOWNLOAD button; on the screen of a series, DOWNLOAD ALL downloads what is missing in every season (and tries again what failed), and each season has its own DOWNLOAD SEASON on its row for the episodes of that season only. OPEN FOLDER is there too.
- The ⚙ at the end of the row of a series has RENAME SERIES (every anime of the series follows, and a season whose order clashes is refused with the next free one) and REMOVE SERIES.
- A paused episode shows as PAUSED, with a RESUME button, and stays paused when the app is closed.
- Search the library by title, open the folder of an anime, and mark episodes as watched (an episode is also marked once you have watched most of it).
- Go from the search to the library, and back, for the same anime (VIEW IN LIBRARY / GO TO SOURCE). The series always opens with every season closed (the one you came for in view when you came from a redirect).
- Removing an anime or a series also deletes its files; an episode cannot be removed alone, and the anime that gives its name to the series is only removed with the whole series.

### Series and seasons
![A series with its episodes](docs/screenshots/anime-series.png)

The source lists every season as a separate anime. Give them the same **series** name and an **order**, and they become one series with its seasons in order. The app suggests the names from the title, and you can change them before adding the anime to the library. After that the series cannot change (rename it from its screen); EDIT SEASON changes the order and the name of a season. A season can have a name of its own instead of "SEASON N".

Click a season to show or hide its episodes, and click a downloaded episode to play it. Changing a season does not move files you already have.

### Player
![The player in fullscreen, cyberpunk theme](docs/screenshots/anime-player.png)

Play and pause, seek (the arrow keys jump 5 seconds), volume, previous and next episode, and a ⚙ with the subtitle settings (which one to show and the size). It remembers where you stopped. Click the video to pause and double-click it for fullscreen; in fullscreen the controls hide when the mouse is still for 3 seconds. In the neon themes (Cyberpunk, Synthwave, Terminal) they float over the video with a glowing progress bar. Escape closes the player.

### Subtitles
- One look for every theme: bold white lettering with a navy outline and no box behind it, like the fansubs.
- Subtitles in the language of the app, or the one you choose in the ⚙ of the ANIME tab, when the source has it. Every language the source offers is saved with the episode and can be picked in the player.
- **Watching without downloading** offers every language the source lists in the ⚙ of the player, with the one that fits the language of the app shown first.
- **CHECK SUBTITLES** looks again for languages the episode does not have yet and adds them.
- Language names appear in the language of the app ("Português (Brasil)").
- **LOAD SUBTITLE** adds your own `.vtt` or `.srt` file to an episode.

### History
Lists the anime you opened or watched, the most recent first, with the last episode you watched. OPEN brings it back with its episodes.

### Keeping your library
- **IMPORT LIBRARY** rebuilds the library from a folder, for a new computer, a reinstall, or after you renamed or moved folders. Episodes downloaded by the app come back exactly as they were, with where you stopped watching. An episode whose file is gone is marked.
- **MIGRATE FOLDER** (in the anime settings) moves the whole library to another folder safely, and points the app to it.
- **UPDATE ANI-CLI** (in the ⚙ of the ANIME tab) gets the newest ani-cli when the source changes and something stops working. It downloads the latest version from the ani-cli project, so use it only if you trust that project (it publishes no signature, so what is checked is that the file looks like ani-cli, that the shell accepts it, and that the changes Pullwave makes to it still fit: if the one that finds the stream no longer fits, it is not installed, and if only a subtitle feature does not fit, it is installed and you are told). **USE THE ONE THAT SHIPS WITH THE APP** deletes the updated one; the version that comes with the app keeps working without it.

### Good to know
The episodes come from an external source that can change or block requests at any time; updating ani-cli often fixes that. Some antivirus programs distrust the small tools ani-cli uses on Windows; they are the official builds (see [`resources/THIRD_PARTY_NOTICES.md`](resources/THIRD_PARTY_NOTICES.md)). Some video formats may not play inside the app. The same disclaimer applies: see [DISCLAIMER.md](DISCLAIMER.md).

## Settings, themes and languages
Settings are saved as you change them. The ⚙ of the top bar has the ones of the whole app:
- **Theme:** Device (follows your system, the default) or one of twelve: the neon ones (Cyberpunk, Synthwave, Terminal in phosphor green) and the flat ones, dark (Dark, Tokyo Night, Nord, Dracula, Gruvbox, AMOLED in pure black, High contrast) or light (Light, Sakura). In the neon themes the controls float over the video in fullscreen with a progress bar that glows in the colors of the theme.
- **Open on:** the tab the app shows when it starts, VIDEO DOWNLOADER (the default) or ANIME (which opens on its schedule).
- **Language:** Device (follows your system, the default), English, Português, Español, 中文 or 日本語. The whole app changes right away.
- **System tray:** keep the app running in the tray when you close the window.
- **App updates:** check for new versions on startup, or now.

The ⚙ of each part has the settings of that part. The app adapts to the size of the window, from a half-screen window up to a 1920x1080 screen.

## Notes
- **System tray on Linux:** it works on KDE, XFCE, Cinnamon, MATE, LXQt and GNOME with an extension. Stock GNOME has no tray: install "AppIndicator and KStatusNotifierItem Support" (Ubuntu ships it enabled; on Fedora `sudo dnf install gnome-shell-extension-appindicator`; on Arch `sudo pacman -S gnome-shell-extension-appindicator`, then enable it). Without one, closing the window quits the app. Right-click the tray icon to restart or quit.
- **Cookies on Windows:** taking cookies from Chrome or Edge can fail because of their newer encryption; Firefox is more reliable.
- **If the app does not start on Linux** because of the system's security settings, run it with `--no-sandbox`.
- The third-party software that comes with the app is listed in [`resources/THIRD_PARTY_NOTICES.md`](resources/THIRD_PARTY_NOTICES.md).

## Development
More documentation is in [`docs/`](docs/README.md); how to publish a version is in [`docs/RELEASING.md`](docs/RELEASING.md).

You need Node.js 22 or newer. To build the Linux packages you also need `rpm`, `libarchive-tools` and `zstd` (`npm run check:tools` tells you what is missing). `npm run fetch-binaries` downloads the tools that come with the app.

| Command | What it does |
|---|---|
| `npm run dev` | Start the app in development mode |
| `npm run build` | Build the app into `out/` |
| `npm test` | Unit tests |
| `npm run test:e2e` | Build and run the end-to-end tests on the real app |
| `npm run typecheck` | Type check |
| `npm run lint` | Lint (no warnings allowed) |
| `npm run fetch-binaries` | Download the bundled tools (`-- --force` to refresh) |
| `npm run dist` | Linux: build and package AppImage, deb, rpm and pacman into `dist/` (never publishes) |
| `npm run dist:win` | Windows: build the installer |
| `npm run release` / `npm run release:win` | Same as `dist` / `dist:win`, then upload to a draft GitHub Release (needs `GH_TOKEN`) |
