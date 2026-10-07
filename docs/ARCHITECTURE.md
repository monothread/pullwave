# Architecture

## Folder structure
```
src/
  shared/        types.ts (Settings, DownloadJob, JobStatus, HistoryEntry, AppUpdateState, CyberApi, ...), constants.ts (IPC channels, defaults), url.ts (isValidHttpUrl)
  main/
    index.ts                    # window, lifecycle, wiring
    ipc/registerHandlers.ts     # typed IPC channels
    services/
      binaryResolver.ts         # where each binary lives (custom > updated > bundled > system)
      binaryLocator.ts          # version probe of the resolved binaries
      ytdlpArgsBuilder.ts       # Settings + URL -> string[] (pure function)
      ytdlpRunner.ts            # spawn, progress, cancellation
      progressParser.ts         # parses the --progress-template output
      errorMapper.ts            # stderr -> { code, title, hint, raw }
      queueManager.ts           # queue + concurrency
      jsonStore.ts / settingsSanitizer.ts / settingsStore.ts / historyStore.ts
      updater.ts                # updates yt-dlp (verified download into userData/bin)
      appUpdateService.ts       # app self-update state machine (electron-updater)
      electronUpdater.ts        # thin adapter around electron-updater's autoUpdater
      trayAvailability.ts       # is a system tray available? (SNI watcher on the session bus + desktop heuristic)
      trayManager.ts            # creates/destroys the tray according to the closeToTray setting
      windowClose.ts            # close action (allow / hide / ask-quit) and the quit confirmation flow
      electronTray.ts           # thin adapter around Electron's Tray + Menu
      mediaKinds.ts             # media type from URL / Content-Type, segment and private-host detection
      pageScanner.ts            # static scan of a page's HTML (and iframes) for video addresses
      sniffRules.ts             # which network requests/responses count as media (pure)
      browserSniffer.ts         # hidden, sandboxed BrowserWindow that watches the page's network
      playlistFilter.ts         # drops HLS quality variants covered by a master playlist
      streamGrouping.ts         # folds near-identical addresses of one video (mirrors/redirects) into one candidate
      streamFinder.ts           # static scan -> hidden browser; keeps candidates' request details in the main process
      # Anime section (Linux and Windows, D-036 to D-041)
      aniCliLocator.ts          # which ani-cli/busybox/curl, tool links, isolated env, patched copy of the script
      aniCliRunner.ts           # spawn `busybox sh ani-cli ...`, menu choices, progress, cancel
      aniCliService.ts          # search, episodes, download, resolveStream on top of the runner
      aniArgsBuilder.ts / aniOutputParser.ts   # validated arguments; parse the menu, progress and errors
      aniSubtitles.ts / aniStream.ts / aniPatches.ts   # run-time patches of ani-cli (subtitle language, referer in debug output)
      aniCliUpdater.ts / aniVersion.ts         # update ani-cli from its repository, versions
      animeDb.ts                # node:sqlite library (anime, episode, progress, anime_history), migrations by user_version
      animeDownloadQueue.ts     # one job per episode, concurrency, progress, retry
      animeFiles.ts             # file/folder names (anime folder, `Episode N` folder), what is removed with an episode or an anime
      subtitleFiles.ts          # subtitles next to a video (default, source, imported), .srt to .vtt, importing a file
      episodeMetadata.ts        # `pullwave.json` next to each video: what the library needs to recognize it again
      libraryScan.ts / libraryImport.ts   # IMPORT LIBRARY: scan a folder (inside the anime folder only), add / skip / point episodes to their new file
      animeMigration.ts         # MIGRATE FOLDER: copy, check, point the library and the settings, remove the old files
    shared/series.ts            # suggestSeries, series names (shared by the screen and the main process), season limits
      mediaProtocol.ts          # pullwave-media:// (downloaded files, byte ranges)
      streamProxy.ts            # pullwave-stream:// (HLS streams fetched with the referer, playlists rewritten)
    animeRuntime.ts             # wires the anime services (null where the section does not exist)
    ipc/registerAnimeHandlers.ts  # anime:* channels (answers "unsupported" where the section does not exist)
  preload/index.ts              # contextBridge with a typed API
  renderer/
    App.tsx, theme/cyberpunk.css, theme/themes.css, theme/responsive.css (scale, width and columns by size of window, D-042)
    i18n/ language (system locale), useTranslator (React hook)
    components/ DownloadsPanel (QUEUE / HISTORY / SETTINGS of the video downloader), UrlInput, QueueList, JobCard, SettingsPanel (scope: global / downloads / anime), HistoryList, ErrorBanner, BinaryStatus,
                Toast, UpdateBanner, UpdateActions, StreamFinder, fields,
                AnimePanel, AnimeSearch, AnimeDetail, AnimeJobs, AnimeLibrary, AnimeHistory, AnimePlayer, AnimeStreamPlayer, AnimeRemove,
                VideoControls (the player's own control bar), subtitleChoice / subtitleScale (what the viewer chose), SeriesFields (series name and season)
    hooks/ useAutoSaveSettings (debounced settings auto-save), useMouseNavigation + navigationHistory (back/forward buttons of the mouse), useFullscreenIdle (controls hide in fullscreen)
    store/ (zustand): appStore.ts, animeStore.ts
test/            # unit tests mirroring src
test/e2e/        # Playwright-Electron (fake yt-dlp via stub)
scripts/         # fetch-binaries.mjs (per platform), check-linux-tools.mjs (rpm/pacman prerequisites)
.github/workflows/  # release-linux.yml, release-windows.yml (manual, build and attach packages to the draft Release)
resources/       # icon.png, THIRD_PARTY_NOTICES.md, ani-scripts/pullwave-run.sh (runs ani-cli with a menu, a player and tput defined as functions), bin/ (git-ignored)
docs/
```

## Flow
Renderer (React) → `window.api` (preload, typed) → IPC → `registerHandlers` → `queueManager` → `ytdlpRunner` (spawn) → progress/error/finish events → IPC push → Zustand store → UI.

Closing the window: `decideCloseAction` → `hide` (tray available and `closeToTray` on), `ask-quit` (ask when downloads are pending, then `app.quit()`) or `allow` (already quitting). The app is single-instance; a second launch shows the window.

On `before-quit` the main process calls `queue.shutdown()`: every running yt-dlp is sent SIGTERM and no queued job is started, so no download (or ffmpeg merge) is left running in the background after the app closes.

## Stream finder
Failed job (`UNKNOWN`/`OUTDATED`) → **FIND STREAM** → `stream:find` (main: `StreamFinder.find`) → stage events (`event:stream-progress`: scanning → watching) → candidate list in the job card → **DOWNLOAD** → `stream:download` → `QueueManager.add(url, { referer, userAgent, cookie, title })` → the usual `ytdlpRunner` flow. Request details (referer, cookies) never reach the renderer. See D-019.

## Anime section (Linux and Windows)
Same shape as the rest: renderer (`animeStore`, `Anime*` components) → `window.api` → `anime:*` IPC (`registerAnimeHandlers`) → `AniCliService` → `aniCliRunner` → `busybox sh pullwave-run.sh ani-cli …` with an isolated environment: on Linux a `PATH` of links to the busybox applets, curl, yt-dlp and ffmpeg made in `userData/anime/tools`; on Windows no links (BusyBox for Windows runs its applets itself) and a `Path` of the bundled folders plus the folders of the chosen yt-dlp and ffmpeg, with only the system variables Windows programs need passed on (`SystemRoot`, `TEMP`, `USERPROFILE`...), and the paths given to the shell with forward slashes. ani-cli has no structured output, so searching and listing work by handing it `pullwave_menu` as its menu program (a function defined by `pullwave-run.sh`, like the stand-in player and `tput`), which reports every choice on stderr; a choice is later picked with `-S <position>` and `-e <episode>`. See D-036.

- **Data:** `userData/anime/anime.db` (`node:sqlite`, migrations by `PRAGMA user_version`); the queue itself is in memory, so at start unfinished episodes become errors that can be retried.
- **Downloads:** `AnimeDownloadQueue` runs one job per episode (a season is all its episodes) up to `maxConcurrent`; events `event:anime-job` and `event:anime-library` push changes to the store.
- **Player:** `<video>` (no native controls: `VideoControls` draws the bar with the theme variables) reads `pullwave-media://episode/<id>` and `.../subtitle/<id>[/<track>]`, served by `mediaProtocol.ts` with byte ranges; a subtitle is looked up among the episode's files by id, never turned into a path. **Watch without downloading:** `anime:stream-open` runs ani-cli with the `debug` player (it prints the address), `StreamSessions` opens a session and hls.js in the renderer plays `pullwave-stream://p/<session>/<address>`, which the main process fetches with the right referer, rewriting playlists. Both schemes are registered as privileged before the app is ready; the CSP allows them (and `blob:` for hls.js). See D-036/D-037.
- **Patches:** ani-cli is pinned and checked by hash; `AniCliLocator.withPatches` runs a patched copy (subtitle language, referer in the debug output) and falls back to the original when its lines do not match (D-037). The script can be updated from the settings (D-038).
- **Folders and the library (D-040):** each episode is downloaded into `<anime folder>/Episode N/` (the queue reuses the folder an anime already has); `pullwave.json` beside the video keeps what the library knows; `anime:import-library` scans a folder chosen in the main process and adds, skips or re-points episodes; `anime:library` also answers which downloaded files are gone (`fileMissing`); `anime:open-folder` opens an anime's folder from an id.
- **Series (D-041):** `anime.series` / `anime.season` (set by the user, suggested by `suggestSeries`) group the entries in the library and name the folder `<series>/Season N/Episode M`; `anime:set-series` validates and refuses a season that is taken; removal never removes whole a folder another entry has files in.
- **Schedule (D-053):** `anime:schedule` → `loadSchedule` (main, `animeSchedule.ts`) asks AniList for the airing episodes of a stretch of time (a day or a week in the time zone the user picked; the day limits are computed in the renderer with `shared/timezone.ts`) and keeps the answer for a day in `anime_schedule_cache`. The tab is `AnimeSchedule`, the first of the section: cards with the cover, grouped by day; a click goes to the search (`openScheduleEntry`), which tries the names of the anime in turn. The source is not checked.
- **Covers (D-054):** `anime:cover` → `AnimeCoverService` (main, `animeCovers.ts`) finds the cover of a title at AniList (one request a second, waiting when it says so), keeps it in `anime_cover`, checks again once a day in the background and tells the renderer (`event:anime-cover`) when one changed. `AnimeCover` shows it in the cards of the schedule, the search, the library and the history.
- **Pause (D-055):** `queue:pause` / `queue:resume` and `anime:pause` / `anime:resume` end the run keeping the partial files (status `paused`) and start it again from them; for anime the status is kept in the library, for the video downloader the paused ones are kept in `userData/paused.json` (without the cookie).
- **Library as the place to download (D-059):** `anime:add-to-library` registers every episode as `idle` (`registerEpisodes`), `anime:download-missing` queues what is not done, `anime:rename-series` renames a series for all its animes (`AnimeDb.renameSeries`) and `anime:open-series-folder` opens its folder. A finished anime job leaves the store and the toast stack (`appStore.toasts`) announces it.
- **Availability of the schedule (D-060):** `AnimeAvailabilityService` (main) looks each anime of the schedule up through `AniCliService.search` (english name, then romaji; two at a time), is available when a result has its title (`comparableTitle`), keeps the answer an hour in `anime_availability` (database version 6) and tells each one by `event:anime-availability`; `anime:availability` answers what is kept and queues the rest; `AnimeRuntime.startBackgroundChecks` checks today at start. The store keeps `availability` by AniList id and `openScheduleEntry` searches by the name that found the anime.
- **Subtitles of a stream (D-056):** the debug output of ani-cli lists every subtitle; `StreamSessions` serves each through the app and the player has a track for each.
- **Translating subtitles (D-062):** `anime:subtitle-translate` / `-estimate` / `-translate-many` / `-translate-cancel` → `SubtitleTranslationQueue` (one episode at a time, cancellable, progress by `event:subtitle-translation`) → `translateEpisodeSubtitle` (reads the subtitle through `SubtitleFileSystem`, `vttCues`, `subtitleTranslator` in batches of a JSON list, `completeWithLlm` for the protocol of the provider) → `<name>.translated-<Language>.vtt`. The provider, model, address and language are settings; the token is kept by `LlmTokenStore` (`safeStorage`, `userData/llm-tokens.json`) and reached through `llm:status`, `llm:token-set` and `llm:token-clear`, which never give it back. The window is `SubtitleTranslateDialog` (player), `SeasonTranslation` (library) and `TranslationSettings` (anime settings). Errors: `docs/ERRORS.md`.
- **Subtitle from the audio (D-063):** `anime:subtitle-generate` / `-generate-estimate` / `-generate-cancel` → `SubtitleGenerationQueue` (the same `SubtitleJobQueue` as the translations, `event:subtitle-generation`) → `generateEpisodeSubtitle` (by the plan of `generatePlanOf`: `audioExtractor`: `probeAudio` and `extractAudioParts` with the bundled ffmpeg into a temporary folder → `transcribeWithSpeechService`, `POST /audio/transcriptions` (or `/audio/translations` for English at once) with `response_format=vtt`, or `transcribeWithGemini` (`geminiSpeech.ts`, `generateContent` with the audio inline, asked for a JSON list of lines that becomes WebVTT, in any language at once), one part of ten minutes at a time → `shiftCues` puts the parts together → `translateTexts` when the text is translated afterwards; it reports phase, plan and bytes) → `<name>.generated-<Language>.vtt`. The service, model and address are settings (`transcribe*`; the spoken language is asked for in the window); the token is in the slot `speech-<provider>` of `LlmTokenStore`. The window is `SubtitleGenerateDialog` (with `GenerateProgressPanel`), opened by the button of the player when the episode has no subtitle (`AnimePlayer`), and the second part of `TranslationSettings`. Errors: `docs/ERRORS.md`.
- **Where it exists:** `isAnimeSupported(platform)` (Linux and Windows). Elsewhere `createAnimeRuntime` returns null; the tab, the settings panel and the version chip are not shown, the protocols are not registered and the IPC channels answer "unsupported".
- **Windows specifics (D-039):** folder names avoid the names Windows reserves and a trailing dot or space, and are shortened so a file path stays under 240 characters; what could not be deleted at once (a file the player has just let go of) is deleted again 500 ms later; cancelling kills the process tree with `taskkill /T /F`.
- **Tests:** `test/e2e/anime.e2e-spec.ts` drives the real app with `test/e2e/fixtures/fake-ani-cli.sh` (set through `PULLWAVE_ANI_CLI`) and a local HLS server that refuses requests without the right referer; `anime-live.e2e-spec.ts` talks to the real source when `PULLWAVE_LIVE=1`. The "Test Windows" workflow runs them (and the unit tests that do not assume POSIX paths) on a real Windows runner.

## Live streams
yt-dlp prints `CYBERINFO|<is_live>|<file>` before downloading → `QueueManager.applyInfo` marks the job `live` and starts a ticker that derives `elapsedSeconds` (own clock) and `downloadedBytes` (size of `<file>.part`). `queue:stop` (**STOP & SAVE**) → `QueueManager.stop` → SIGINT (file kept); cancel stays SIGTERM. `before-quit` awaits `QueueManager.shutdown()` when live jobs exist. See D-025.

## Feature → yt-dlp args (`ytdlpArgsBuilder`)
| Feature | Args |
|---|---|
| Default folder | `-P <dir>` (fallback `~/Downloads`) |
| Browser cookies | `--cookies-from-browser <browser>[:profile]` (optional, off by default) |
| Best audio + video | `-f "bv*+ba/b"`; capped: `bv*[height<=N]+ba/b[height<=N]` |
| Output format | `--merge-output-format mp4\|mkv\|webm` |
| Audio only | `-x --audio-format mp3\|m4a\|opus` |
| Title length | `-o "%(title).{N}s [%(id)s].%(ext)s" --trim-filenames 240` |
| Playlist | `--yes-playlist` / `--no-playlist` |
| Subtitles | `--sub-langs <..>`, then `--embed-subs` or `--write-subs` (embedding removes the separate files), plus `--write-auto-subs` when enabled |
| Progress | `--newline --progress-template "download:CYBERPROG\|%(progress._percent_str)s\|..."` plus `--print after_move:CYBERFILE\|%(filepath)s` |
| Live streams | `--wait-for-video 30` (wait setting); `--live-from-start --downloader-args ffmpeg_i:-live_start_index 0` (from-start setting); `--print before_dl:CYBERINFO\|%(is_live)s\|%(filename)s` always |
| Extras | rate limit, concurrency, custom paths, JS runtime, extra args |
| Stream found on a page | `--referer <page>`, `--user-agent <UA used to find it>`, `--add-header Cookie:<cookies seen>`, `--force-ipv4/--force-ipv6` when the address is bound to an IP, file named from the page title |

## Languages
English, Portuguese, Spanish, Chinese and Japanese (D-029). The catalogs are in `src/shared/i18n/` (`en.ts` defines the keys, the other four are typed against it, so a missing key fails `tsc`). The renderer reads them through `useTranslator()`; the main process through `translateMain` (`src/main/services/language.ts`), which follows the saved `language` setting.

## Theme
Neon cyan/magenta/yellow on a dark background, mono font, scanlines, glitch on titles, glowing borders. Errors in neon red.

## Tests
- Unit: `test/main/**`, `test/renderer/**`, `test/shared/**`; helpers in `test/helpers/` (`mockApi.ts`, `fakeChild.ts`, `tempDir.ts`).
- e2e: `test/e2e/app.e2e-spec.ts` launches the real Electron app (run `npm run build` first) with a temporary `--user-data-dir` and `FAKE_YTDLP_LOG` to record the fake yt-dlp's argv and `PATH`.

## Bundled binaries
`scripts/fetch-binaries.mjs [--platform=linux|win32] [--out=<dir>] [--force]` → `resources/bin/` (git-ignored): `yt-dlp`, `ffmpeg`, `ffprobe`, `deno`, `ffmpeg-GPLv3.txt` on Linux (plus `resources/lib/` with ffmpeg's shared libraries, see D-024, and `resources/bin/ani/` with `ani-cli`, a static `busybox` and a static `curl`, each pinned to one version and one sha256, D-036), and the same with `.exe` on Windows (no `lib/`; `ani/` holds `ani-cli`, `busybox.exe` (busybox-w32, 64-bit Unicode) and `curl.exe`, D-039). Every download is checked against the checksum its source publishes. In dev the app uses `<appPath>/resources/bin`; packaged, `process.resourcesPath/bin`. See D-013.

## Platforms
| OS | Package | Built by | Auto-update |
|---|---|---|---|
| Ubuntu/Debian and derivatives | `.deb` | `npm run release` locally or the "Release Linux" workflow | yes (package manager, asks for a password) |
| Fedora | `.rpm` | same as above | yes (same mechanism) |
| Arch Linux | `.pacman` | same as above | yes (same mechanism) |
| Any Linux | `.AppImage` | same as above | yes (replaces its own file) |
| Windows 10/11 x64 | NSIS `…-setup.exe` (per-user, one click) | the "Release Windows" workflow (`npm run release:win` on a Windows machine) | yes (electron-updater, `latest.yml`) |

Platform differences live in small, injectable spots: `executableName`/`spawnEnv` in `binaryResolver.ts` (`.exe`, `Path` key), the yt-dlp asset name in `updater.ts`, and `checkTraySupport` (the D-Bus check only runs on Linux).
