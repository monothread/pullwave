# Conventions

## Code
- Strict TypeScript; no unnecessary `any`; types/interfaces in `src/shared/` (or a dedicated types file), never inline when an interface fits.
- Arrow functions always use a block body with an explicit `return` (no implicit returns).
- Conditionals always use `{}` (avoid `if (x) return y;`).
- Small, focused functions; extract when one takes on too many responsibilities; no duplication.
- Modify only what the task requires; out-of-scope observations go in notes, untouched.
- No two files in a folder may differ only in casing (`MangaSearch.tsx` and `mangaSearch.ts`): it is fine on Linux and breaks the build on Windows (found in 0.21.3).

## Tests
- Every module has a complete test: definition, every if/else, loops, calls with exact parameters, success, failure and edge cases.
- Unit **and** e2e are both evaluated whenever production code changes.
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

## Git
- Commit messages in English; no AI attribution in any file, commit or PR.
- Never push or deploy without explicit confirmation.

## Confirmations
Before deleting files, overwriting on a large scale, removing dependencies or making irreversible external calls: list the impact and ask for an explicit "yes".

## Final summary of each task
Files changed · what changed (one line per file) · files intentionally left untouched · follow-ups.
