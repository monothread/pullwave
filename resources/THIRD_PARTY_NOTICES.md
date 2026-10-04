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
