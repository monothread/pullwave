import type { ErrorDetails } from '@shared/errorDetails';
import type { AniDownloadProgress, AniError, AniErrorCode, AnimeSearchResult } from '@shared/anime';
import { SOURCE_ID_MARKER } from './aniMenuIds';
import { SEARCH_MORE_MARKER } from './aniSearchPages';
import { describeError } from './errorDetails';

// Prefix of every choice that `pullwave_menu` (the stand-in for fzf, see pullwave-run.sh) reports on stderr: PULLWAVE_MENU<TAB>prompt<TAB>line.
export const MENU_PREFIX = 'PULLWAVE_MENU';
export const ANIME_PROMPT = 'Select anime:';
export const EPISODE_PROMPT = 'Select episode:';

const RAW_LIMIT = 4000;
const ANSI_PATTERN = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*[A-Za-z]`, 'g');
const PROGRESS_PATTERN = /^\[download\]\s+(\d+(?:\.\d+)?)%\s+of\s+~?\s*(\d+(?:\.\d+)?)([KMGT]?i?B)(?:\s+in\s+\S+)?(?:\s+at\s+(\S+(?:\s\S+)?\/s))?(?:\s+ETA\s+(\S+))?/;
const DESTINATION_PATTERN = /^\[download\] Destination: (.+)$/;
const UNITS: Record<string, number> = {
    B: 1,
    KiB: 1024,
    MiB: 1024 ** 2,
    GiB: 1024 ** 3,
    TiB: 1024 ** 4
};

interface ErrorRule {
    code: AniErrorCode;
    patterns: RegExp[];
}

// ani-cli ends with `die "<message>"`; the first rule that matches wins.
const ERROR_RULES: ErrorRule[] = [
    { code: 'NO_RESULTS', patterns: [/no results found/i] },
    { code: 'BLOCKED', patterns: [/blocked by cloudflare/i] },
    { code: 'EPISODE_NOT_RELEASED', patterns: [/episode not released/i] },
    { code: 'NO_SOURCES', patterns: [/no sources found/i, /no valid sources/i] },
    { code: 'INVALID_SELECTION', patterns: [/invalid (anime|episode) selection/i, /invalid episode/i, /invalid range/i, /out of range/i] },
    { code: 'BINARY_MISSING', patterns: [/program \S+ not found/i, /neither yt-dlp nor ffmpeg found/i, /no player found/i] },
    {
        code: 'NETWORK',
        patterns: [/connection error/i, /request failed: http/i, /curl exit/i, /could not resolve/i, /timed out/i, /network is unreachable/i, /http error 5\d\d/i]
    }
];

export function stripAnsi(text: string): string {
    return text.replace(ANSI_PATTERN, '').replace(/\r/g, '');
}

function truncateRaw(text: string): string {
    const trimmed = text.trim();
    return trimmed.length > RAW_LIMIT ? trimmed.slice(-RAW_LIMIT) : trimmed;
}

export function mapAniError(output: string, exitCode: number | null, known: Partial<ErrorDetails> = {}): AniError {
    const raw = truncateRaw(stripAnsi(output));
    const details: ErrorDetails = { occurredAt: Date.now(), ...(exitCode === null ? {} : { exitCode }), ...known };
    const matchedRule = ERROR_RULES.find((rule) => {
        return rule.patterns.some((pattern) => {
            return pattern.test(raw);
        });
    });
    if (matchedRule) {
        return { code: matchedRule.code, raw, details };
    }
    return { code: 'UNKNOWN', raw: raw.length > 0 ? raw : `ani-cli exited with code ${exitCode ?? 'unknown'}`, details };
}

export function mapAniSpawnError(error: NodeJS.ErrnoException, known: Partial<ErrorDetails> = {}): AniError {
    return { code: error.code === 'ENOENT' ? 'BINARY_MISSING' : 'UNKNOWN', raw: error.message, details: describeError(error, known) };
}

// Whether the line is the one the search of the app prints when the source has a page after the last one it read (see aniSearchPages.ts).
export function isSearchMoreLine(line: string): boolean {
    return stripAnsi(line).trim() === SEARCH_MORE_MARKER;
}

// One choice reported by `pullwave-menu`, or null when the line is anything else ani-cli printed.
export function parseMenuLine(line: string): { prompt: string; choice: string } | null {
    const [prefix, prompt, ...rest] = line.split('\t');
    if (prefix !== MENU_PREFIX || prompt === undefined || rest.length === 0) {
        return null;
    }
    return { prompt: prompt.trim(), choice: rest.join('\t') };
}

// A search result is shown as "<index> <title>", or "<index> pwid:<id> <title>" when the script lets the id of the source through (see
// aniMenuIds.ts): the marker tells the id from the first word of a title, whatever the id looks like.
export function parseAnimeChoice(choice: string): AnimeSearchResult | null {
    const match = /^(\d+) (.+)$/.exec(choice.trim());
    if (!match) {
        return null;
    }
    const rest = (match[2] ?? '').trim();
    const marked = new RegExp(`^${SOURCE_ID_MARKER}(\\S+) (.+)$`).exec(rest);
    if (marked) {
        return { index: Number(match[1]), title: (marked[2] ?? '').trim(), sourceId: marked[1] as string };
    }
    return { index: Number(match[1]), title: rest };
}

export function parseProgressLine(line: string): AniDownloadProgress | null {
    const match = PROGRESS_PATTERN.exec(stripAnsi(line).trim());
    if (!match) {
        return null;
    }
    const unit = UNITS[match[3] ?? ''];
    const size = Number(match[2]);
    return {
        percent: Number(match[1]),
        totalBytes: unit === undefined ? null : Math.round(size * unit),
        speed: match[4] ?? null,
        eta: match[5] ?? null
    };
}

export function parseDestinationLine(line: string): string | null {
    const match = DESTINATION_PATTERN.exec(stripAnsi(line).trim());
    return match?.[1] ?? null;
}
