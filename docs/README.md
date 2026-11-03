# Pullwave — Documentation

Desktop app for Linux and Windows (Electron + React + TypeScript) with a cyberpunk look and flat themes: a video downloader (`yt-dlp`, with a queue, a history and a cutter), an anime library and player (`ani-cli`) and a manga reader (Suwayomi-Server and the Mihon/Tachiyomi extensions).

> Every download made with the program is at the user's own risk and responsibility; the authors are not responsible
> for it. The project-level statement is in [`../DISCLAIMER.md`](../DISCLAIMER.md) and must stay linked from the README
> and from the app's settings screens.

## Start here (new sessions/agents)
1. Read `PROGRESS.md` — current state and next task.
2. Read `DECISIONS.md` — decisions already made (do not reopen them without a reason).
3. Read `ARCHITECTURE.md` and `CONVENTIONS.md` before writing code.
4. Follow `WORKFLOW.md` (handoff protocol) when starting and finishing.

## Index
| File | Contents |
|---|---|
| `PROGRESS.md` | Checklist per phase/task, status, owner, handoff notes |
| `DECISIONS.md` | Decision log (lightweight ADR) with context and consequences |
| `ARCHITECTURE.md` | Folder structure, modules, IPC flow, feature → yt-dlp args mapping |
| `CONVENTIONS.md` | Code, test, lint and commit standards |
| `WORKFLOW.md` | How to resume work, split tasks between agents, update docs |
| `ERRORS.md` | Catalog of yt-dlp errors and friendly messages |
| `DESIGN.md` | Map of every feature, the console design system, keyboard and gamepad navigation, how the design is verified |
| `RELEASING.md` | How to publish a version and how the app updates itself |
| `screenshots/` | The images of the README, made by `npm run screenshots` (D-144) |
| `LOG.md` | Chronological session diary (append-only) |

## Golden rule
Every session ends with `PROGRESS.md` and `LOG.md` updated. A new decision means a new entry in `DECISIONS.md`.
