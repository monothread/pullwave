import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { getText, isVersionTag, UpdateLookupError } from './suwayomiUpdate';

// Looking for a newer FlareSolverr (the latest release of its project, which is also the tag of its image) and remembering which one
// the app runs. The image is checked by Docker itself when it is pulled.

export const FLARESOLVERR_LATEST_URL = 'https://api.github.com/repos/FlareSolverr/FlareSolverr/releases/latest';

export async function fetchLatestFlareSolverr(fetchImpl: typeof fetch = fetch): Promise<string> {
    const answer: unknown = JSON.parse(await getText(FLARESOLVERR_LATEST_URL, fetchImpl, 'application/vnd.github+json'));
    const version = (typeof answer === 'object' && answer !== null ? (answer as Record<string, unknown>)['tag_name'] : undefined) ?? null;
    if (!isVersionTag(version)) {
        throw new UpdateLookupError('The latest release has a version that is not understood');
    }
    return version;
}

// The version the user updated to, as it was kept; null when there is none or what was kept is not valid.
export function readSelectedFlareSolverr(file: string): string | null {
    try {
        const raw = JSON.parse(readFileSync(file, 'utf-8')) as { version?: unknown };
        return isVersionTag(raw.version) ? raw.version : null;
    } catch {
        return null;
    }
}

export function writeSelectedFlareSolverr(file: string, version: string): void {
    mkdirSync(dirname(file), { recursive: true });
    const partial = `${file}.part`;
    writeFileSync(partial, JSON.stringify({ version }), 'utf-8');
    renameSync(partial, file);
}

export function clearSelectedFlareSolverr(file: string): void {
    rmSync(file, { force: true });
}
