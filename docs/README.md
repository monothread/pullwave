# Pullwave — Documentation

Desktop app for Linux and Windows (Electron + React + TypeScript) with a cyberpunk look and flat themes: a video downloader (`yt-dlp`, with a queue, a media explorer, a history, and unified media tools for cutting, converting to audio, and merging videos), an anime library and player (`ani-cli`) and a manga reader (Suwayomi-Server and the Mihon/Tachiyomi extensions).

> Every download made with the program is at the user's own risk and responsibility; the authors are not responsible
> for it. The project-level statement is in [`../DISCLAIMER.md`](../DISCLAIMER.md) and must stay linked from the README
> and from the app's settings screens.

## Start here (new sessions/agents)
**Only the code is used as reference.** What the app does (behavior, rules, architecture, constants, file names, flags) is learned from the code alone: these documents are never a source for it. When a document contradicts the code, the code is right; the document is outdated and is fixed.

1. Read `PROGRESS.md` — the tasks and their status.
2. Read `CONVENTIONS.md` — how code, tests and commits are written.
3. Follow `WORKFLOW.md` (handoff protocol) when starting and finishing.
4. Read the code of everything the task touches before changing it. `DECISIONS.md` and `ARCHITECTURE.md` are records kept in line with the code, not a reference.

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
| `PERFORMANCE.md` | The memory and GPU review: how it was measured, what was proved and fixed, what was not (D-200) |
| `LOG.md` | Chronological session diary (append-only) |

## Golden rule
Every session ends with `PROGRESS.md` and `LOG.md` updated. A new decision means a new entry in `DECISIONS.md`.
