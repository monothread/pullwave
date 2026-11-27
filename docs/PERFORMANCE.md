# Performance: the review of memory and GPU use (2026-11-14)

The owner saw the GPU and the RAM go very high while many mangas and animes downloaded at once. Every problem below was first **proved by a
measurement** on the real app, then fixed, then **measured again** with the same load. What could not be proved was not changed. The visual
design and the animations were not to change at all (D-200).

## How it was measured
- The app built from the sources, run with an isolated user data folder (`--user-data-dir` in a temporary folder): a copy of the programs
  (`tools`), of the Suwayomi server with its extensions, and a copy of the real libraries (684 mangas with 32 584 chapters, 352 animes with
  4 159 episodes), with every path of the real disk rewritten to a folder that does not exist, so nothing real could be touched.
- Real downloads: animes through the real ani-cli (Spy x Family, Frieren), mangas through the real Suwayomi (Weeb Central and MangaRead.org,
  up to 200 chapters, 6 at a time).
- The window on the real screen (the GPU of the machine, not a virtual screen), driven with Playwright. Every 5 s: the memory and the CPU of
  each process of the app (main, window, GPU process, Suwayomi's Java, yt-dlp, ffmpeg), the `gpu_busy_percent` of the graphics card, and the
  metrics of the page from the DevTools protocol (style recalculations, layouts and their time, script time, JS heap). The IPC was counted by
  wrapping `webContents.send` and the invoke handlers.
- To find a cause, one thing at a time was switched off for the measurement only (CSS injected in the page, `requestAnimationFrame` held,
  `document.getAnimations()` paused), never in the code.
- A visual change was checked pixel by pixel: frames of the animation at fixed moments, before and after, in three themes. Two runs of the
  same code differ by 0 pixels, so any difference is the change.

## Proved and fixed

| # | Problem | Proof (before) | After |
|---|---|---|---|
| 1 | Every chapter that started or ended made the window read the **whole manga library** again (all mangas with all chapters), and the main process build it, with a sync check per manga | 6 chapters at a time: 132 reads, 12.2 s of the main process blocked (up to 157 ms each), window JS heap 44 → **1 488 MB**, window 2 003 MB, main CPU 34%, window CPU 64% | 6 reads (only the ones that are not chapter events) + 102 reads of one manga (25 ms in all); heap max **104 MB**, window 474 MB, main CPU 11%, window CPU 44% |
| 2 | The same flood in RESUME ALL / resume mangas (`retry`), cancel of waiting chapters and the repair of missing pages (found by the code review) | one whole-library read per chapter (50 paused chapters = 50 reads) | one read of the manga |
| 2b | The **anime library** the same way: every episode that started, ended, was repaired or had its audio checked (and RESUME ALL, DOWNLOAD ALL AGAIN, cancel of waiting episodes) read every anime with every episode, with a look at the disk for each downloaded one | 9 real episodes: 22 whole-library reads, 797 ms of the main process blocked (up to 44 ms each), window JS heap up to 56 MB | 1 whole-library read (48 ms) + 26 reads of one anime (4 ms in all, 0.2 ms at most); heap up to 20 MB |
| 3 | A **minimized** window kept every animation running: on Linux Chromium does not tell the page the window is minimized | minimized = visible: GPU process 41–48% CPU, window 18–25% | GPU 0–1%, window 0–1%, no animation running |
| 4 | The animations of the **cards out of sight**: a queue draws up to 60 cards, only ~3 are seen, the other 57 kept 171 of the 196 animations running | 60 cards, 3 chapters running: window 119% CPU, main thread 97% busy, style 0.77 s per s | window 107–110%, style 0.56–0.59 s per s (the same as a list of 10 cards: the queue no longer costs anything); with 6 chapters GPU process 161% → **82%** |
| 5 | Suwayomi's Java never gave memory back (heap may grow to ¼ of the RAM, 8 GB here) | 557 → 953 MB during 200 chapters, still 894 MB after 3 min idle | 649 MB after idle (peak the same), 200 chapters, 0 errors, 2 min 52 s against 3 min 18 s |
| 6 | Suwayomi's Java compiled its code with both compilers (C1 and C2), whose compiled code and compiler threads take memory, for a server that uses ~1% of the processor | 60 chapters, two rounds: idle 576/593 MB, peak 776/765 MB, after 90 s idle 759/699 MB, 65/65 s | with the quick compiler only: idle 418/485 MB, peak 493/405 MB, after idle 419/347 MB (~45% less), 66/67 s, 0 errors |

### How
1. `MangaDownloadQueue` calls `onLibraryEntryChanged(mangaId)` when a chapter starts, ends, fails on the disk, is retried or a waiting one is
   cancelled; `MangaRepair` does the same for a repaired chapter. The main process sends `event:manga-library-entry`, the window asks
   `manga:library-entry` for that manga alone and puts it in place in `library` (the other mangas keep their objects, so nothing else is
   drawn again). A manga that is not in the library of the window, or no longer in the main process, or that cannot be read, makes the
   whole library be read as before. `keyedRefresh` reads one manga at a time: requests that come while it is read make one more read after it.
   The anime library does the same (`onLibraryEntryChanged(animeId)` in `AnimeDownloadQueue`, `event:anime-library-entry`,
   `anime:library-entry`); both stores share `libraryEntryRefresh`.
2. `watchMinimized` (main, `windowMinimized.ts`) tells the page `event:window-minimized` on minimize/restore/show/maximize/focus (`MINIMIZE_EVENTS`; each reads `isMinimized()`), and
   tells it again when the page is loaded; the preload keeps the last state for a page that subscribes late.
3. and 4. `fx/loopPause.ts` pauses, through the animations themselves, **only the animations that loop forever**: all of them while the
   window is minimized, and those of a card marked `data-offscreen` by one shared `IntersectionObserver` (`useOffscreenPause`, with a
   `scrollMargin` of 200 px because the lists scroll inside `.app__main`, so a card animates again before it is seen). An animation that
   starts later (`animationstart`) is settled as it starts. Animations that play once (the stamp of a finished download, the flash of its
   bar, the countdown of the end check of a live stream, the drain of a notice, the dot of the spotlight) are never paused: a first version
   paused everything with CSS and the review proved it left a blank badge, a late countdown and notices out of step with their timers.
5. and 6. `SERVER_JVM_ARGS` in `suwayomiServer.ts`: `-XX:G1PeriodicGCInterval=30000 -XX:MinHeapFreeRatio=10 -XX:MaxHeapFreeRatio=30
   -XX:TieredStopAtLevel=1`. No `-Xmx`: a heavy source still gets the memory it needs. The downloads wait on the network, so the slower
   code of the quick compiler did not show in the time of the chapters.

## Proved, not changed
- **The neon bars that are on screen.** With the queue fixed, 3–4 bars in sight still keep the window at ~100% CPU and the GPU process at
  ~80%: four chained `drop-shadow`s and a mask animated on the main thread at every frame, by design (D-192). Making them cheaper means
  building the effect another way; it is a proposal, not done.
- **The light over the main button (`bp-sheen`).** It alone keeps the window redrawing (GPU process 44%, window 16% with nothing else
  running). The same light moved with `transform` was measured and compared: up to 15/255 on the rounded corners in every frame and on
  thousands of pixels while it passes. Not identical, so it was reverted.
- **Minimized while downloads end.** The notices (5 s drain synced with a JS timer), their sparks and the confetti of each finished
  chapter still play (GPU process ~46%, window ~21% with 3 chapters running). They are one-shot animations tied to timers; pausing them
  showed a wrong state on restore.

## Not confirmed, not changed
- **`-N 16` of yt-dlp:** 3 real episodes, alternated twice: same memory with 4 or 16 (peak ~270 MB), 4 not faster (39–57 s against 39–41 s).
- **The anime and manga progress events:** ~8 per second and ~1 350 in a run, cheap; the cost was the library read that came with them.
- **The bars that glide (`useSmoothPercent`):** their script is ~1% (0.011 s per s); the cost of each frame is the layout and paint of the
  bar, which a DOM write would not remove.
- **The frame loops while minimized:** holding every `requestAnimationFrame` changed nothing.
- **Unbounded output strings of yt-dlp/ani-cli, the reorder buffer of the HLS recorder:** the main process stayed at 240–415 MB through
  every run; not reproduced.
- **A window hidden in the tray** already cost 0–2%: Chromium pauses it on its own.

## Code reviews
Two rounds of review by agents that only reported what they could prove; every proven finding was fixed and is covered by tests:
- the other paths of the flood (RESUME ALL, cancel of waiting items, repair of pages; then the same in the anime queue);
- the minimized state lost when the page loads (or reloads) before it listens: sent again on `did-finish-load`, kept by the preload;
- the first version, which paused every animation with CSS, froze one-shot animations (blank badge, late countdown, notices out of step
  with their timers): replaced by `loopPause.ts`, which pauses only the looping ones;
- the 200 px margin did nothing for a list that scrolls inside `.app__main`: `scrollMargin`;
- staggered looping animations (the arrows of the auto scroll of the reader) that started while minimized lost their stagger: the whole page,
  or the whole card, is settled when one of its animations starts.

## Known limits and risks
- **`-XX:TieredStopAtLevel=1`** was measured on downloads, which wait on the network. A source whose extension does a lot of work on the
  processor (unscrambling pictures, scripts against bots) could be slower with the quick compiler; not measured. It is one entry of
  `SERVER_JVM_ARGS` to take out if that shows.
- **Window managers:** the window coming back is read on minimize, restore, show, maximize and focus. On Wayland Electron may not report a
  minimized window: the pause then simply does not happen (as before).
- The preload (the last minimized state replayed to a late subscriber) and the wiring in `main/index.ts` have no unit test: the project
  has none for these two files; the e2e of the minimized window covers them end to end.

## Measured on 2026-11-14, Linux (X11, AMD GPU), 16 cores, 32 GB
Windows: the minimize events and the JVM flags are the same there (Windows already tells Chromium about a minimized window; the message
is harmless). Not measured on Windows.

## Opt-in Performance mode (2026-11-27, D-213)
The heavy visual hotspots previously left unchanged in Normal mode (neon progress bar chained `drop-shadow`/mask animations, `bp-sheen`, full-viewport aurora, `backdrop-filter` blurs, ambient `Backdrop` blur, and decorative JS/React `requestAnimationFrame` loops) are now addressable on demand through **Settings → General → Appearance & Window → Performance mode** (`Settings.performanceMode`, off by default).

- **Measured in Electron (1920×1080, `cyberpunk` theme, `xvfb-run`):** Home idle CPU dropped from `133.1%` (`11` infinite animation loops) to `1.6%` (`0` loops); a screen with 6 finished progress bars dropped from `284.6%` (`23` loops) to `1.6%` (`0` loops).
- **Mandatory rule going forward:** every future design or UI feature must be implemented in **both Normal mode and Performance mode** (`src/renderer/theme/performance.css` and `usePerformanceMode()` / `isPerformanceModeActive()`), keeping Normal mode visually complete while ensuring Performance mode adds zero heavy GPU/CPU loops, blurs, or filters (see `CONVENTIONS.md` and `DESIGN.md`).
