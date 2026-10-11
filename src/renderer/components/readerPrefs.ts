// What the reader remembers: how the user likes to read (it is kept for every manga) and where they stopped in each chapter. It lives
// in the storage of the window, which can be empty or refuse to be read: the reader then starts from its defaults.

export const READER_MODES = ['single', 'vertical', 'webtoon'] as const;
export const READER_DIRECTIONS = ['ltr', 'rtl'] as const;
export const READER_SCALES = ['width', 'height', 'screen', 'original'] as const;
export const READER_BACKGROUNDS = ['dark', 'black', 'gray', 'white'] as const;

export type ReaderMode = (typeof READER_MODES)[number];
export type ReaderDirection = (typeof READER_DIRECTIONS)[number];
export type ReaderScale = (typeof READER_SCALES)[number];
export type ReaderBackground = (typeof READER_BACKGROUNDS)[number];

export interface ReaderPrefs {
    mode: ReaderMode;
    direction: ReaderDirection;
    scale: ReaderScale;
    background: ReaderBackground;
}

export const DEFAULT_READER_PREFS: ReaderPrefs = { mode: 'single', direction: 'ltr', scale: 'screen', background: 'dark' };

export const PREFS_KEY = 'pullwave.manga.reader';
export const PROGRESS_KEY = 'pullwave.manga.progress';
export const MAX_REMEMBERED_CHAPTERS = 500;

function pick<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
    return allowed.includes(value as T) ? (value as T) : fallback;
}

export function loadReaderPrefs(): ReaderPrefs {
    try {
        const raw = JSON.parse(window.localStorage.getItem(PREFS_KEY) ?? '{}') as Record<string, unknown>;
        return {
            mode: pick(raw['mode'], READER_MODES, DEFAULT_READER_PREFS.mode),
            direction: pick(raw['direction'], READER_DIRECTIONS, DEFAULT_READER_PREFS.direction),
            scale: pick(raw['scale'], READER_SCALES, DEFAULT_READER_PREFS.scale),
            background: pick(raw['background'], READER_BACKGROUNDS, DEFAULT_READER_PREFS.background)
        };
    } catch {
        return DEFAULT_READER_PREFS;
    }
}

export function saveReaderPrefs(prefs: ReaderPrefs): void {
    try {
        window.localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
    } catch {
        // Not kept: the next time the reader starts from its defaults.
    }
}

function readProgress(): Record<string, number> {
    try {
        const raw = JSON.parse(window.localStorage.getItem(PROGRESS_KEY) ?? '{}') as unknown;
        if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
            return {};
        }
        return Object.fromEntries(
            Object.entries(raw).filter((entry): entry is [string, number] => {
                return typeof entry[1] === 'number' && Number.isInteger(entry[1]) && entry[1] >= 0;
            })
        );
    } catch {
        return {};
    }
}

// The page (from 0) a chapter was left on; 0 when it was not read.
export function loadProgress(key: string): number {
    return readProgress()[key] ?? 0;
}

export function saveProgress(key: string, page: number): void {
    try {
        const all = readProgress();
        delete all[key];
        // The latest are kept last: the oldest go first when there are too many.
        const entries = [...Object.entries(all), [key, page] as [string, number]].slice(-MAX_REMEMBERED_CHAPTERS);
        window.localStorage.setItem(PROGRESS_KEY, JSON.stringify(Object.fromEntries(entries)));
    } catch {
        // Not kept.
    }
}

export function progressKey(mangaTitle: string, chapterRemoteId: number): string {
    return `${mangaTitle}|${String(chapterRemoteId)}`;
}
