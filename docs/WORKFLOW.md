# Multi-session / multi-agent workflow

## When starting
1. Read `PROGRESS.md` (find `TODO` tasks with no pending dependency).
2. Read `DECISIONS.md`, `ARCHITECTURE.md`, `CONVENTIONS.md` as pointers only: confirm in the code anything you rely on (the code wins when they disagree, and the document is then fixed).
3. Claim the task: set its status to `DOING` and fill in `Owner` (e.g. `session-2026-09-30-a`).

## While working
- Work on one task at a time; respect the files listed in the task to avoid conflicts between parallel agents.
- Tasks from different phases can only run in parallel if they do not share files (`Files` column).
- New decision or change of direction → new entry in `DECISIONS.md`.
- New yt-dlp error mapped → `ERRORS.md`.

## When finishing
1. Run the checks from `CONVENTIONS.md` (tsc, eslint, vitest).
2. Mark the task `DONE` in `PROGRESS.md` with a handoff note (what was done, what is missing, pitfalls).
3. Append an entry to `LOG.md` (date, owner, summary, files).

## Allowed statuses
`TODO` · `DOING` · `BLOCKED` (explain why) · `DONE`

## Suggested parallelization
- Phase 2: `ytdlpArgsBuilder`, `progressParser`, `errorMapper` and the stores are independent → separate agents.
- Phase 4: UI components are independent once Phase 3 is done (preload contract closed).
