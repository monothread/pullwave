# Third-party software bundled with Pullwave

This application redistributes unmodified binaries of the following projects.

| Component | Purpose | License | Source |
|---|---|---|---|
| yt-dlp (`yt-dlp_linux` / `yt-dlp.exe`) | Video downloading | The Unlicense. The official binaries are PyInstaller bundles that also embed Python (PSF License) and other libraries; see the yt-dlp repository for their licenses | https://github.com/yt-dlp/yt-dlp |
| FFmpeg / ffprobe | Merging, converting and recording media | GPLv3 (see `bin/ffmpeg-GPLv3.txt`). Linux: shared build by BtbN (programs in `bin`, libraries in `lib`). Windows: "essentials" build by gyan.dev | https://github.com/BtbN/FFmpeg-Builds , https://www.gyan.dev/ffmpeg/builds/ (source and build information available there and at https://ffmpeg.org) |
| Deno | JavaScript runtime used by yt-dlp for YouTube | MIT | https://github.com/denoland/deno |
| ani-cli | Anime section: searches and downloads episodes | GPLv3 | https://github.com/pystardust/ani-cli |
| BusyBox (static build 1.35.0 on Linux; busybox-w32 FRP-6075, 64-bit Unicode, on Windows) | The shell and the core utilities (sed, grep, cut...) ani-cli runs on, so nothing is needed from the system | GPLv2 | https://busybox.net , https://frippery.org/busybox/ (source available at both) |
| curl (static build by stunnel/static-curl) | The HTTPS requests of ani-cli | curl license (MIT-style) | https://github.com/stunnel/static-curl , https://curl.se |
| hls.js | Anime section: plays HLS streams in the player (part of the app's interface code) | Apache-2.0 | https://github.com/video-dev/hls.js |
| OpenPGP.js (`openpgp`, an unmodified npm package that stays a separate library inside the application) | Checks the signature of a yt-dlp release before an update is installed | LGPL-3.0-or-later | https://github.com/openpgpjs/openpgpjs |
| Electron / Chromium | Application runtime | MIT and various (see the bundled `LICENSE.electron.txt` / `LICENSE` and `LICENSES.chromium.html`) | https://www.electronjs.org |

The FFmpeg, ani-cli, BusyBox and curl binaries are separate programs executed as child processes; they are not linked into the application.

## Downloaded when the manga section is opened (not part of the package)

| Component | Purpose | License | Source |
|---|---|---|---|
| Suwayomi-Server (with its Java runtime, Azul Zulu) | Runs the Mihon/Tachiyomi extensions that read the manga sites; a separate program, started as a child process and driven over its network interface | MPL-2.0 (the compatibility layer and parts adopted from Mihon: Apache-2.0; the runtime: GPLv2 with Classpath Exception) | https://github.com/Suwayomi/Suwayomi-Server |

| FlareSolverr (with a Chromium it carries) | Gets requests to sites past the check of Cloudflare, by opening the page in a real browser; a separate program, run by the app as a Docker container (image `ghcr.io/flaresolverr/flaresolverr`) that listens on this machine only | MIT (Chromium: BSD-style and others) | https://github.com/FlareSolverr/FlareSolverr |

Suwayomi is downloaded from the releases of the project, checked against the checksum the release publishes and kept in the data folder of the app; FlareSolverr's image is pulled by Docker from the registry of the project; neither is redistributed by Pullwave.

The packages `tar` (ISC), `yauzl` (MIT) and `yazl` (MIT) unpack the download and write the CBZ files; they are part of the application.

