# Publishing a new version

The app updates itself (via `electron-updater`) from the **public Releases** of
`github.com/monothread/pullwave`. Configuration lives in `electron-builder.yml` (`publish`).

## Step by step (all platforms)
1. Bump the version in `package.json` (semver; the app only offers versions **greater** than the installed one).
2. Run the checks: `npx tsc --noEmit --project tsconfig.json`, `npx eslint src/ test/ --max-warnings=0`, `npx vitest run`, `npm run test:e2e`.
3. Push `main` to GitHub (`git push origin main`). Releases are built from the code that is on GitHub.
4. **Linux packages** (AppImage, deb, rpm for Fedora, pacman for Arch), pick one:
   - Locally: `sudo apt install rpm libarchive-tools zstd` once, then `export GH_TOKEN=<token>` and `npm run release`.
   - On GitHub: Actions tab → **Release Linux** → *Run workflow* (no token needed, it uses the repository's own).
5. **Windows installer:** Actions tab → **Release Windows** → *Run workflow*.
6. Each run uploads its files to the **draft** Release `v<version>` (creating it if needed): Linux uploads `pullwave-<version>.{AppImage,deb,rpm,pacman}` and `latest-linux.yml`; Windows uploads `pullwave-<version>-setup.exe` and `latest.yml`. Wait until every run you started has finished.
7. On GitHub, open the draft Release, check the assets and click **Publish release**. Drafts are **not** seen by installed apps.
8. In the Release notes, mention where the FFmpeg source code can be found (https://github.com/BtbN/FFmpeg-Builds on both systems; GPLv3). The app also downloads ani-cli (GPLv3, https://github.com/pystardust/ani-cli), BusyBox (GPLv2, https://busybox.net) and a static curl (https://github.com/stunnel/static-curl); see `resources/THIRD_PARTY_NOTICES.md`.

Run the two workflows **one after the other**, not at the same time: both create the draft Release if it does not exist yet, and running them in parallel can create two drafts for the same tag.

Rules that keep the updater working:
- Publish the Release only **after** all platforms were uploaded.
- Do not build Linux both locally and on GitHub for the same version: both upload `latest-linux.yml` and the last one wins.

`npm run dist` (Linux) and `npm run dist:win` (a Windows machine) generate the same files in `dist/` **without publishing**.

## How the app updates
- On startup (if "Check for updates on startup" is on, 5 s after opening) and via the **CHECK FOR UPDATES** button in Settings.
- If a newer version exists, a yellow banner appears with **UPDATE TO x.y.z** → downloads (only the changed blocks) → **RESTART & INSTALL**.
- Installing takes a separate click on purpose: restarting interrupts downloads in progress.
- **AppImage:** replaces its own file (needs write permission where the file lives).
- **.deb, .rpm and .pacman:** `electron-updater` uses the system package manager (apt/dpkg, dnf/rpm, pacman) and asks for a password (polkit/pkexec).
- **Windows:** the NSIS installer updates itself silently for the current user; releases are unsigned, so Windows SmartScreen may warn on the first install.
- In development (`npm run dev`) the app shows "Updates are only available in the installed app.".
- With no Release published yet, the check shows "No published versions on GitHub" — that is expected before the first one.

## Things to keep in mind
- The repository must be **public** (the app does not carry a token).
- The packages do not contain yt-dlp, deno, ffmpeg, ani-cli, busybox or curl: the app downloads them the first time it opens (D-099), and its "Status of the programs" boxes update them, independent of the app version.
- The version of each program the app is made with (and its sha256) is pinned in `src/main/services/tools/programSpecs.ts`; to move one, change it there. ffmpeg has no pinned version: the first install takes the latest build and the box can bring a newer one.
- `npm run fetch-binaries` is only for the end-to-end tests (it fills `resources/bin` with real copies, which `test/e2e/programs.ts` links into the folder that stands for the downloaded programs); `npm run dist` / `npm run release` do not run it and the packages do not include them.
- Before releasing, run `npm run test:e2e` locally (Linux, with a fake ani-cli) and the **Test Windows** workflow (Actions tab; `live=true` also runs the tests that use the real source, which needs the network and can fail because of the source). The Windows installer is not code-signed; antivirus programs may distrust BusyBox/curl, which are the official builds.
- Code signing is not required on Linux. On Windows it is optional, but unsigned installers trigger a SmartScreen warning.

## Troubleshooting
- **`npm run release` stops with "Missing tools needed to build the rpm and pacman packages":** install what it lists (`sudo apt install rpm libarchive-tools zstd` on Ubuntu) or use the **Release Linux** workflow.
- **A Windows or Linux workflow run created a second draft:** the draft is matched by tag; if it was already published, unpublish it or delete the extra draft and run again before publishing.
- **The app says "No published versions on GitHub" or never shows the banner:** the Release is still a draft. Publish it, then confirm with
  `curl -s https://api.github.com/repos/monothread/pullwave/releases/latest | grep -E '"tag_name"|"name"'`.
- **403 "Resource not accessible by personal access token" on `npm run release`:** the token cannot write Releases. Use a fine-grained token with *Contents: Read and write* on this repository (repository access must be "Only select repositories"), or a classic token with the `repo` scope.
- **The upload looks stuck:** electron-builder prints nothing while uploading ~470 MB; check the Assets of the draft Release on GitHub.
- **Installed version < new version but no banner:** an app older than 0.1.1 crashes with `write EPIPE` when opened from a file manager; open it from a terminal or download the new file manually.
