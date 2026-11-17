import type { MangaChapterMove } from '@shared/manga';

export const READER_MODES = ['single', 'vertical', 'webtoon'] as const;
export const READER_DIRECTIONS = ['ltr', 'rtl'] as const;
export const READER_SCALES = ['width', 'height', 'screen', 'original'] as const;
export const READER_BACKGROUNDS = ['dark', 'black', 'gray', 'white'] as const;

export type ReaderMode = (typeof READER_MODES)[number];
export type ReaderDirection = (typeof READER_DIRECTIONS)[number];
export type ReaderScale = (typeof READER_SCALES)[number];
export type ReaderBackground = (typeof READER_BACKGROUNDS)[number];

export const MIN_AUTO_SCROLL_SPEED = 10;
export const MAX_AUTO_SCROLL_SPEED = 600;
export const AUTO_SCROLL_STEP = 10;
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
    chapterSwitch: boolean;
    twoPages: boolean;
}

export const DEFAULT_READER_PREFS: ReaderPrefs = { mode: 'single', direction: 'ltr', scale: 'width', background: 'dark', autoScrollSpeed: 80, pageGap: 8, chapterSwitch: true, twoPages: false };

export const PREFS_KEY = 'pullwave.manga.reader';
export const PREFS_BY_MANGA_KEY = 'pullwave.manga.readerByManga';
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

function parsePrefs(raw: Record<string, unknown>): ReaderPrefs {
    return {
        mode: pick(raw['mode'], READER_MODES, DEFAULT_READER_PREFS.mode),
        direction: pick(raw['direction'], READER_DIRECTIONS, DEFAULT_READER_PREFS.direction),
        scale: pick(raw['scale'], READER_SCALES, DEFAULT_READER_PREFS.scale),
        background: pick(raw['background'], READER_BACKGROUNDS, DEFAULT_READER_PREFS.background),
        autoScrollSpeed: pickSpeed(raw['autoScrollSpeed'], DEFAULT_READER_PREFS.autoScrollSpeed),
        pageGap: pickGap(raw['pageGap'], DEFAULT_READER_PREFS.pageGap),
        chapterSwitch: typeof raw['chapterSwitch'] === 'boolean' ? raw['chapterSwitch'] : DEFAULT_READER_PREFS.chapterSwitch,
        twoPages: typeof raw['twoPages'] === 'boolean' ? raw['twoPages'] : DEFAULT_READER_PREFS.twoPages
    };
}

function readPrefsByManga(): Record<string, Record<string, unknown>> {
    try {
        const raw = JSON.parse(window.localStorage.getItem(PREFS_BY_MANGA_KEY) ?? '{}') as unknown;
        if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
            return {};
        }
        return Object.fromEntries(
            Object.entries(raw).filter((entry): entry is [string, Record<string, unknown>] => {
                return typeof entry[1] === 'object' && entry[1] !== null && !Array.isArray(entry[1]);
            })
        );
    } catch {
        return {};
    }
}

export function loadReaderPrefs(mangaTitle?: string): ReaderPrefs {
    try {
        const own = mangaTitle === undefined ? undefined : readPrefsByManga()[mangaTitle];
        if (own !== undefined) {
            return parsePrefs(own);
        }
        return parsePrefs(JSON.parse(window.localStorage.getItem(PREFS_KEY) ?? '{}') as Record<string, unknown>);
    } catch {
        return DEFAULT_READER_PREFS;
    }
}

export function saveReaderPrefs(prefs: ReaderPrefs, mangaTitle?: string): void {
    try {
        window.localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
        if (mangaTitle !== undefined) {
            const all = readPrefsByManga();
            delete all[mangaTitle];
            const entries = [...Object.entries(all), [mangaTitle, prefs] as [string, unknown]].slice(-MAX_REMEMBERED_MANGAS);
            window.localStorage.setItem(PREFS_BY_MANGA_KEY, JSON.stringify(Object.fromEntries(entries)));
        }
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

export function loadProgress(key: string): number {
    return readProgress()[key] ?? 0;
}

export function saveProgress(key: string, page: number): void {
    try {
        const all = readProgress();
        delete all[key];
        const entries = [...Object.entries(all), [key, page] as [string, number]].slice(-MAX_REMEMBERED_CHAPTERS);
        window.localStorage.setItem(PROGRESS_KEY, JSON.stringify(Object.fromEntries(entries)));
    } catch {
        // Not kept.
    }
}

export function progressKey(mangaTitle: string, chapterRemoteId: number): string {
    return `${mangaTitle}|${String(chapterRemoteId)}`;
}

export const READ_KEY = 'pullwave.manga.read';
export const LAST_CHAPTER_KEY = 'pullwave.manga.last';
export const LAST_PAGE_KEY = 'pullwave.manga.lastPage';
export const MAX_READ_CHAPTERS = 50000;
export const MAX_REMEMBERED_MANGAS = 500;

export function loadAllProgress(): Record<string, number> {
    return readProgress();
}

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


function chapterRenames(fromTitle: string, toTitle: string, moves: readonly MangaChapterMove[]): Map<string, string> {
    return new Map(
        moves.map((move) => {
            return [progressKey(fromTitle, move.from), progressKey(toTitle, move.to)];
        })
    );
}

export function hasReadUnderTitle(readKeys: readonly string[], title: string, chapterRemoteIds: readonly number[]): boolean {
    const read = new Set(readKeys);
    return chapterRemoteIds.some((chapterRemoteId) => {
        return read.has(progressKey(title, chapterRemoteId));
    });
}

export function orphanReadIds(readKeys: readonly string[], titles: readonly string[], knownChapterIds: ReadonlySet<number>): number[] {
    const wanted = new Set(titles);
    const orphans = new Set<number>();
    readKeys.forEach((key) => {
        const separator = key.lastIndexOf('|');
        const chapterRemoteId = Number(key.slice(separator + 1));
        if (separator > 0 && wanted.has(key.slice(0, separator)) && Number.isInteger(chapterRemoteId) && chapterRemoteId > 0 && !knownChapterIds.has(chapterRemoteId)) {
            orphans.add(chapterRemoteId);
        }
    });
    return [...orphans];
}

export function movedReadKeys(keys: readonly string[], fromTitle: string, toTitle: string, moves: readonly MangaChapterMove[]): string[] {
    const renames = chapterRenames(fromTitle, toTitle, moves);
    const moved = new Set<string>();
    keys.forEach((key) => {
        moved.add(renames.get(key) ?? key);
    });
    return [...moved];
}

export function copiedReadKeys(keys: readonly string[], fromTitle: string, toTitle: string, moves: readonly MangaChapterMove[]): string[] {
    const renames = chapterRenames(fromTitle, toTitle, moves);
    const copied = new Set(keys);
    keys.forEach((key) => {
        const target = renames.get(key);
        if (target !== undefined) {
            copied.add(target);
        }
    });
    return [...copied];
}

export function copyChapterProgress(fromTitle: string, toTitle: string, moves: readonly MangaChapterMove[]): void {
    try {
        const all = readProgress();
        let changed = false;
        chapterRenames(fromTitle, toTitle, moves).forEach((target, source) => {
            const page = all[source];
            if (page !== undefined && !(target in all)) {
                all[target] = page;
                changed = true;
            }
        });
        if (changed) {
            window.localStorage.setItem(PROGRESS_KEY, JSON.stringify(all));
        }
    } catch {
        // Not kept.
    }
}

function movedProgress(all: Record<string, number>, renames: ReadonlyMap<string, string>): Record<string, number> {
    const moved: Record<string, number> = {};
    Object.entries(all).forEach(([key, page]) => {
        const target = renames.get(key);
        if (target === undefined) {
            moved[key] = page;
        } else if (!(target in all)) {
            moved[target] = page;
        }
    });
    return moved;
}

function movedTitleEntry<T>(all: Record<string, T>, fromTitle: string, toTitle: string, carried: (value: T) => T | null): Record<string, T> | null {
    const current = all[fromTitle];
    const value = current === undefined ? null : carried(current);
    if (value === null) {
        return null;
    }
    const moved = { ...all };
    delete moved[fromTitle];
    if (!(toTitle in moved)) {
        moved[toTitle] = value;
    }
    return moved;
}

function writeIfMoved(storageKey: string, moved: Record<string, unknown> | null): void {
    if (moved !== null) {
        window.localStorage.setItem(storageKey, JSON.stringify(moved));
    }
}

export function moveMangaReading(fromTitle: string, toTitle: string, moves: readonly MangaChapterMove[]): void {
    const destinations = new Map(
        moves.map((move) => {
            return [move.from, move.to];
        })
    );
    try {
        window.localStorage.setItem(PROGRESS_KEY, JSON.stringify(movedProgress(readProgress(), chapterRenames(fromTitle, toTitle, moves))));
        writeIfMoved(
            LAST_CHAPTER_KEY,
            movedTitleEntry(readLastChapters(), fromTitle, toTitle, (chapterRemoteId) => {
                return destinations.get(chapterRemoteId) ?? null;
            })
        );
        writeIfMoved(
            LAST_PAGE_KEY,
            movedTitleEntry(readLastPositions(), fromTitle, toTitle, (position) => {
                const chapterRemoteId = destinations.get(position.chapterRemoteId);
                return chapterRemoteId === undefined ? null : { chapterRemoteId, page: position.page };
            })
        );
        if (fromTitle !== toTitle) {
            writeIfMoved(
                PREFS_BY_MANGA_KEY,
                movedTitleEntry(readPrefsByManga(), fromTitle, toTitle, (prefs) => {
                    return prefs;
                })
            );
        }
    } catch {
        // Not kept.
    }
}
