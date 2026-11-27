# Conventions

## Code
- Strict TypeScript; no unnecessary `any`; types/interfaces in `src/shared/` (or a dedicated types file), never inline when an interface fits.
- Arrow functions always use a block body with an explicit `return` (no implicit returns).
- Conditionals always use `{}` (avoid `if (x) return y;`).
- Small, focused functions; extract when one takes on too many responsibilities; no duplication.
- No comments in the code (any file type): names, types and small functions carry the meaning. Only these are allowed: legal/license headers, documentation comments of a public API, tool directives (`// prettier-ignore`, `eslint-disable-*`, `@ts-expect-error`, `// @vitest-environment`, `/// <reference>`, shebangs), links to issues/RFCs that explain a constraint the code cannot express, and non-obvious behavior forced by an external dependency. A comment-only body that exists only to satisfy a lint rule (an empty `catch {}`) is tolerated.
- Only the code is used as reference: every check (behavior, rules, architecture, constants, file names, flags) is made in the code, never in the documentation. When a document contradicts the code, the code is right and the document is fixed.
- Modify only what the task requires; out-of-scope observations go in notes, untouched.
- No two files in a folder may differ only in casing (`MangaSearch.tsx` and `mangaSearch.ts`): it is fine on Linux and breaks the build on Windows (found in 0.21.3).

## Design and Performance mode (mandatory for every UI/design change)
Pullwave has two visual modes controlled by `Settings.performanceMode` (default `false`, toggled in **Settings → General → Appearance & Window**, persisted in `settings.json` and mirrored to `localStorage` under `pullwave-performance-mode` and `<html data-performance-mode>`):
- **Normal mode (`performanceMode: false`):** full visual experience with all animations, transitions, glows, blurs, particles, and decorative loops active.
- **Performance mode (`performanceMode: true`, `:root[data-performance-mode]`):** preserves layout, spacing, theme palette, typography, and overall design fidelity while eliminating hardware-heavy GPU/CPU work.

Whenever implementing or changing any visual feature, component, theme rule, animation, or effect, **you must implement it for both modes**:
1. **CSS (`src/renderer/theme/performance.css`, loaded last):** add `:root[data-performance-mode]` overrides for any new infinite or heavy animation, `backdrop-filter`, expensive `filter`/`drop-shadow`, large multi-layer `box-shadow` glow, or GPU-heavy transition. Keep readable solid/translucent fallbacks and never hide or freeze terminal/interactive states (e.g. completed badges, progress bars, focus rings, overlays).
2. **JS/React (`usePerformanceMode()` in components/hooks, `isPerformanceModeActive()` in imperative helpers):** guard any new decorative `requestAnimationFrame` loop, parallax/3D tilt handler, ripple, particle/confetti burst, animated counter, flying cover, or View Transition so it performs zero unnecessary work when Performance mode is active, while still showing the exact final data/state immediately.
3. **Live runtime toggling (`OFF → ON → OFF`):** toggling Performance mode at runtime without restarting must immediately stop active effects and clear inline styles/timers/listeners, and turning it back off must cleanly restore Normal mode with no stale state.

## Tests
- Every module has a complete test: definition, every if/else, loops, calls with exact parameters, success, failure and edge cases.
- Unit **and** e2e are both evaluated whenever production code changes.
- Any UI/design change that introduces animations, visual effects, or `:root[data-performance-mode]` rules must be tested in **both Normal mode and Performance mode**, including live toggling `OFF → ON → OFF`.
- e2e: verify the result/status, relevant headers (if HTTP) and the full payload/shape.
- Assertions use concrete values (`toEqual`, `toMatchObject`); no `any`/`expect.anything()` (exception: `expect.any(Date)`).
- `describe`/`it` names and test comments are written in **English**.

## Mandatory verification at the end of any task
```
npx tsc --noEmit --project tsconfig.json
npx eslint src/ test/ --max-warnings=0
npx vitest run
```
Fix everything before considering the task done.

## Screenshots
- `docs/screenshots` is made by `npm run screenshots` (`scripts/screenshots`, D-144): invented titles, fake programs and servers, a temporary user-data folder. Never take them from an installed app. After a change of design, run it again and look at every image.

## Git
- Commit messages in English; no AI attribution in any file, commit or PR.
- Never push or deploy without explicit confirmation.

## Confirmations
Before deleting files, overwriting on a large scale, removing dependencies or making irreversible external calls: list the impact and ask for an explicit "yes".

## Final summary of each task
Files changed · what changed (one line per file) · files intentionally left untouched · follow-ups.
