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

// How fast the scroll goes by itself, in pixels per second.
export const MIN_AUTO_SCROLL_SPEED = 10;
export const MAX_AUTO_SCROLL_SPEED = 600;
export const AUTO_SCROLL_STEP = 10;
// The space between the pages in the vertical scroll, in pixels (0 joins them).
export const MIN_PAGE_GAP = 0;
export const MAX_PAGE_GAP = 100;
export const PAGE_GAP_STEP = 4;

export interface ReaderPrefs {
    mode: ReaderMode;
    direction: ReaderDirection;
    scale: ReaderScale;
    background: ReaderBackground;
    autoScrollSpeed: number;
    pageGap: number;
    // In the scroll modes the next (or previous) chapter opens by itself when the user scrolls through the zone between chapters.
    chapterSwitch: boolean;
}

export const DEFAULT_READER_PREFS: ReaderPrefs = { mode: 'single', direction: 'ltr', scale: 'width', background: 'dark', autoScrollSpeed: 80, pageGap: 8, chapterSwitch: true };

export const PREFS_KEY = 'pullwave.manga.reader';
export const PROGRESS_KEY = 'pullwave.manga.progress';
export const MAX_REMEMBERED_CHAPTERS = 500;

function pick<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
    return allowed.includes(value as T) ? (value as T) : fallback;
}

function pickSpeed(value: unknown, fallback: number): number {
    return typeof value === 'number' && Number.isFinite(value) ? Math.min(MAX_AUTO_SCROLL_SPEED, Math.max(MIN_AUTO_SCROLL_SPEED, Math.round(value))) : fallback;
}

function pickGap(value: unknown, fallback: number): number {
    return typeof value === 'number' && Number.isFinite(value) ? Math.min(MAX_PAGE_GAP, Math.max(MIN_PAGE_GAP, Math.round(value))) : fallback;
}

export function loadReaderPrefs(): ReaderPrefs {
    try {
        const raw = JSON.parse(window.localStorage.getItem(PREFS_KEY) ?? '{}') as Record<string, unknown>;
        return {
            mode: pick(raw['mode'], READER_MODES, DEFAULT_READER_PREFS.mode),
            direction: pick(raw['direction'], READER_DIRECTIONS, DEFAULT_READER_PREFS.direction),
            scale: pick(raw['scale'], READER_SCALES, DEFAULT_READER_PREFS.scale),
            background: pick(raw['background'], READER_BACKGROUNDS, DEFAULT_READER_PREFS.background),
            autoScrollSpeed: pickSpeed(raw['autoScrollSpeed'], DEFAULT_READER_PREFS.autoScrollSpeed),
            pageGap: pickGap(raw['pageGap'], DEFAULT_READER_PREFS.pageGap),
            chapterSwitch: typeof raw['chapterSwitch'] === 'boolean' ? raw['chapterSwitch'] : DEFAULT_READER_PREFS.chapterSwitch
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

// ----- Chapters read, and the chapter each manga was left on -----

export const READ_KEY = 'pullwave.manga.read';
export const LAST_CHAPTER_KEY = 'pullwave.manga.last';
export const LAST_PAGE_KEY = 'pullwave.manga.lastPage';
export const MAX_READ_CHAPTERS = 50000;
export const MAX_REMEMBERED_MANGAS = 500;

// Every page left on, by chapter, read once (the list of chapters of a manga asks for many).
export function loadAllProgress(): Record<string, number> {
    return readProgress();
}

// The chapters that were read to the end or marked as read, by the key of the chapter (see `progressKey`).
export function loadReadKeys(): string[] {
    try {
        const raw = JSON.parse(window.localStorage.getItem(READ_KEY) ?? '[]') as unknown;
        return Array.isArray(raw)
            ? raw.filter((item): item is string => {
                  return typeof item === 'string';
              })
            : [];
    } catch {
        return [];
    }
}

export function saveReadKeys(keys: readonly string[]): void {
    try {
        window.localStorage.setItem(READ_KEY, JSON.stringify(keys.slice(-MAX_READ_CHAPTERS)));
    } catch {
        // Not kept.
    }
}

function readLastChapters(): Record<string, number> {
    try {
        const raw = JSON.parse(window.localStorage.getItem(LAST_CHAPTER_KEY) ?? '{}') as unknown;
        if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
            return {};
        }
        return Object.fromEntries(
            Object.entries(raw).filter((entry): entry is [string, number] => {
                return typeof entry[1] === 'number' && Number.isInteger(entry[1]);
            })
        );
    } catch {
        return {};
    }
}

// The chapter a manga (by its title) was last read in; null when none.
export function loadLastChapter(mangaTitle: string): number | null {
    return readLastChapters()[mangaTitle] ?? null;
}

export function saveLastChapter(mangaTitle: string, chapterRemoteId: number): void {
    try {
        const all = readLastChapters();
        delete all[mangaTitle];
        const entries = [...Object.entries(all), [mangaTitle, chapterRemoteId] as [string, number]].slice(-MAX_REMEMBERED_MANGAS);
        window.localStorage.setItem(LAST_CHAPTER_KEY, JSON.stringify(Object.fromEntries(entries)));
    } catch {
        // Not kept.
    }
}

export interface LastPosition {
    chapterRemoteId: number;
    // The page (from 0) the user was last on in that chapter, the last page of it included.
    page: number;
}

function readLastPositions(): Record<string, LastPosition> {
    try {
        const raw = JSON.parse(window.localStorage.getItem(LAST_PAGE_KEY) ?? '{}') as unknown;
        if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
            return {};
        }
        return Object.fromEntries(
            Object.entries(raw).filter((entry): entry is [string, LastPosition] => {
                const value = entry[1] as Partial<LastPosition> | null;
                return typeof value === 'object' && value !== null && Number.isInteger(value.chapterRemoteId) && Number.isInteger(value.page) && (value.page ?? -1) >= 0;
            })
        );
    } catch {
        return {};
    }
}

// Where a manga (by its title) was last read: the chapter and the page, kept as they were even when the chapter was read to its last page
// (the page kept for a chapter, see `saveProgress`, goes back to the first one then, so the chapter starts over when it is opened).
export function loadLastPosition(mangaTitle: string): LastPosition | null {
    return readLastPositions()[mangaTitle] ?? null;
}

export function saveLastPosition(mangaTitle: string, chapterRemoteId: number, page: number): void {
    try {
        const all = readLastPositions();
        const current = all[mangaTitle];
        if (current !== undefined && current.chapterRemoteId === chapterRemoteId && current.page === page) {
            return;
        }
        delete all[mangaTitle];
        const entries = [...Object.entries(all), [mangaTitle, { chapterRemoteId, page }] as [string, LastPosition]].slice(-MAX_REMEMBERED_MANGAS);
        window.localStorage.setItem(LAST_PAGE_KEY, JSON.stringify(Object.fromEntries(entries)));
    } catch {
        // Not kept.
    }
}

