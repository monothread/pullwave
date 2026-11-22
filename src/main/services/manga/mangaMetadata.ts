import { lstatSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, posix, win32 } from 'node:path';
import { cleanSeasonName, cleanSeriesName, isValidSeason } from '@shared/series';
import { hasChapterFile, LOCAL_MANGA_SOURCE_ID, MANGA_STATUSES, type LibraryManga, type MangaChapterRecord, type MangaStatus } from '@shared/manga';
import { MAX_LOCAL_PAGES } from './localPages';
import { asSourceId, asStoreUrl, MAX_DESCRIPTION, MAX_GENRES, MAX_TEXT, MAX_URL } from './mangaRequests';

export const MANGA_METADATA_FILE = 'pullwave.json';
export const MANGA_METADATA_VERSION = 1;
export const MAX_METADATA_BYTES = 2 * 1024 * 1024;
export const MAX_METADATA_CHAPTERS = 10_000;
const SAFE_THUMBNAIL_PATH = /^\/api\/v1\/manga\/\d+\/thumbnail(?:[?#][^\s]*)?$/;

export interface MangaChapterMetadata {
    fileName: string;
    remoteId: number;
    name: string;
    number: number | null;
    dateUploaded: number | null;
    scanlator: string | null;
    sourceOrder: number;
    pageCount: number;
    incomplete: boolean;
}

export interface MangaMetadata {
    version: typeof MANGA_METADATA_VERSION;
    sourceId: string;
    remoteId: number;
    title: string;
    thumbnailUrl: string | null;
    url: string | null;
    author: string | null;
    artist: string | null;
    description: string | null;
    genres: string[];
    status: MangaStatus;
    series?: string;
    season?: number;
    seasonName?: string;
    chapters: MangaChapterMetadata[];
}

export interface MangaMetadataFiles {
    read: (path: string) => string | null;
    write: (path: string, content: string) => void;
}

function isSymbolicLinkPath(path: string): boolean {
    try {
        return lstatSync(path).isSymbolicLink();
    } catch {
        return false;
    }
}

export const defaultMangaMetadataFiles: MangaMetadataFiles = {
    read: (path) => {
        try {
            const stats = lstatSync(path);
            if (!stats.isFile() || stats.isSymbolicLink() || stats.size > MAX_METADATA_BYTES) {
                return null;
            }
            return readFileSync(path, 'utf-8');
        } catch {
            return null;
        }
    },
    write: (path, content) => {
        if (isSymbolicLinkPath(path)) {
            return;
        }
        mkdirSync(dirname(path), { recursive: true });
        writeFileSync(path, content, 'utf-8');
    }
};

function pathFor(platform: NodeJS.Platform): typeof posix {
    return platform === 'win32' ? win32 : posix;
}

export function mangaMetadataPath(mangaFolder: string, platform: NodeJS.Platform = process.platform): string {
    return pathFor(platform).join(mangaFolder, MANGA_METADATA_FILE);
}

function nullableString(value: unknown, max: number = MAX_TEXT): string | null {
    if (typeof value !== 'string') {
        return null;
    }
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed.slice(0, max) : null;
}

function safeThumbnail(value: unknown): string | null {
    if (typeof value !== 'string' || value.length > MAX_URL) {
        return null;
    }
    return SAFE_THUMBNAIL_PATH.test(value) ? value : null;
}

function validSourceId(value: unknown): string | null {
    if (value === LOCAL_MANGA_SOURCE_ID) {
        return LOCAL_MANGA_SOURCE_ID;
    }
    return asSourceId(value);
}

function validRemoteId(value: unknown, sourceId: string): number | null {
    if (typeof value !== 'number' || !Number.isSafeInteger(value) || value === 0) {
        return null;
    }
    if (sourceId === LOCAL_MANGA_SOURCE_ID) {
        return value < 0 ? value : null;
    }
    return value >= 1 ? value : null;
}

function nullableFiniteNumber(value: unknown): number | null {
    return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function parseChapterMetadata(raw: unknown, sourceId: string): MangaChapterMetadata | null {
    if (typeof raw !== 'object' || raw === null) {
        return null;
    }
    const { fileName, remoteId, name, number, dateUploaded, scanlator, sourceOrder, pageCount, incomplete } = raw as Record<string, unknown>;
    const validId = validRemoteId(remoteId, sourceId);
    if (
        typeof fileName !== 'string' ||
        fileName.trim().length === 0 ||
        fileName.length > MAX_TEXT ||
        fileName.includes('/') ||
        fileName.includes('\\') ||
        fileName === '.' ||
        fileName === '..' ||
        validId === null ||
        typeof name !== 'string' ||
        typeof sourceOrder !== 'number' ||
        !Number.isFinite(sourceOrder) ||
        typeof pageCount !== 'number' ||
        !Number.isInteger(pageCount) ||
        pageCount < 0 ||
        pageCount > MAX_LOCAL_PAGES
    ) {
        return null;
    }
    return {
        fileName,
        remoteId: validId,
        name: name.slice(0, MAX_TEXT),
        number: nullableFiniteNumber(number),
        dateUploaded: nullableFiniteNumber(dateUploaded),
        scanlator: nullableString(scanlator, MAX_TEXT),
        sourceOrder,
        pageCount,
        incomplete: incomplete === true
    };
}

export function metadataOfManga(
    manga: LibraryManga,
    chapters: readonly MangaChapterRecord[],
    platform: NodeJS.Platform = process.platform
): MangaMetadata {
    const path = pathFor(platform);
    const joined =
        manga.series !== null && manga.season !== null
            ? { series: manga.series, season: manga.season, ...(manga.seasonName !== null ? { seasonName: manga.seasonName } : {}) }
            : {};
    return {
        version: MANGA_METADATA_VERSION,
        sourceId: manga.sourceId,
        remoteId: manga.remoteId,
        title: manga.title,
        thumbnailUrl: manga.thumbnailUrl,
        url: manga.url,
        author: manga.author,
        artist: manga.artist,
        description: manga.description,
        genres: [...manga.genres],
        status: manga.status,
        ...joined,
        chapters: chapters
            .filter((chapter): chapter is MangaChapterRecord & { filePath: string } => {
                return hasChapterFile(chapter.status) && chapter.filePath !== null;
            })
            .map((chapter) => {
                return {
                    fileName: path.basename(chapter.filePath),
                    remoteId: chapter.remoteId,
                    name: chapter.name,
                    number: chapter.number,
                    dateUploaded: chapter.dateUploaded,
                    scanlator: chapter.scanlator,
                    sourceOrder: chapter.sourceOrder,
                    pageCount: chapter.pageCount,
                    incomplete: chapter.status === 'incomplete'
                };
            })
    };
}

export function parseMangaMetadata(content: string): MangaMetadata | null {
    let raw: unknown;
    try {
        raw = JSON.parse(content);
    } catch {
        return null;
    }
    if (typeof raw !== 'object' || raw === null) {
        return null;
    }
    const { version, sourceId, remoteId, title, thumbnailUrl, url, author, artist, description, genres, status, series, season, seasonName, chapters } = raw as Record<string, unknown>;
    const checkedSourceId = validSourceId(sourceId);
    const checkedRemoteId = checkedSourceId === null ? null : validRemoteId(remoteId, checkedSourceId);
    if (
        version !== MANGA_METADATA_VERSION ||
        checkedSourceId === null ||
        checkedRemoteId === null ||
        typeof title !== 'string' ||
        title.trim().length === 0 ||
        !Array.isArray(chapters)
    ) {
        return null;
    }
    const parsedGenres = Array.isArray(genres)
        ? genres
              .filter((genre): genre is string => {
                  return typeof genre === 'string' && genre.trim().length > 0;
              })
              .slice(0, MAX_GENRES)
              .map((genre) => {
                  return genre.trim().slice(0, MAX_TEXT);
              })
        : [];
    const parsedStatus: MangaStatus = typeof status === 'string' && (MANGA_STATUSES as readonly string[]).includes(status) ? (status as MangaStatus) : 'unknown';
    const cleanedSeries = typeof series === 'string' ? cleanSeriesName(series) : null;
    const cleanedName = typeof seasonName === 'string' ? cleanSeasonName(seasonName) : null;
    const joined = cleanedSeries !== null && isValidSeason(season) ? { series: cleanedSeries, season, ...(cleanedName ? { seasonName: cleanedName } : {}) } : {};
    const parsedChapters = chapters.slice(0, MAX_METADATA_CHAPTERS).flatMap((chapter) => {
        const parsed = parseChapterMetadata(chapter, checkedSourceId);
        return parsed === null ? [] : [parsed];
    });
    return {
        version,
        sourceId: checkedSourceId,
        remoteId: checkedRemoteId,
        title: title.trim().slice(0, MAX_TEXT),
        thumbnailUrl: safeThumbnail(thumbnailUrl),
        url: asStoreUrl(url),
        author: nullableString(author, MAX_TEXT),
        artist: nullableString(artist, MAX_TEXT),
        description: nullableString(description, MAX_DESCRIPTION),
        genres: parsedGenres,
        status: parsedStatus,
        ...joined,
        chapters: parsedChapters
    };
}

export function readMangaMetadata(mangaFolder: string, files: Pick<MangaMetadataFiles, 'read'> = defaultMangaMetadataFiles, platform: NodeJS.Platform = process.platform): MangaMetadata | null {
    const content = files.read(mangaMetadataPath(mangaFolder, platform));
    return content === null ? null : parseMangaMetadata(content);
}

export function writeMangaMetadata(mangaFolder: string, metadata: MangaMetadata, files: Pick<MangaMetadataFiles, 'write'> = defaultMangaMetadataFiles, platform: NodeJS.Platform = process.platform): void {
    try {
        files.write(mangaMetadataPath(mangaFolder, platform), `${JSON.stringify(metadata, null, 2)}\n`);
    } catch {
        return;
    }
}

export function refreshMangaMetadataFor(
    manga: LibraryManga,
    files: Pick<MangaMetadataFiles, 'write'> = defaultMangaMetadataFiles,
    platform: NodeJS.Platform = process.platform
): void {
    const path = pathFor(platform);
    const byFolder = new Map<string, MangaChapterRecord[]>();
    manga.chapters.forEach((chapter) => {
        if (!hasChapterFile(chapter.status) || chapter.filePath === null) {
            return;
        }
        const folder = path.dirname(chapter.filePath);
        const list = byFolder.get(folder) ?? [];
        list.push(chapter);
        byFolder.set(folder, list);
    });
    byFolder.forEach((chapters, folder) => {
        if (path.basename(folder).length === 0) {
            return;
        }
        writeMangaMetadata(folder, metadataOfManga(manga, chapters, platform), files, platform);
    });
}

export function refreshMangaMetadata(
    db: { getLibraryManga: (id: number) => LibraryManga | null },
    mangaId: number,
    files: Pick<MangaMetadataFiles, 'write'> = defaultMangaMetadataFiles,
    platform: NodeJS.Platform = process.platform
): void {
    const manga = db.getLibraryManga(mangaId);
    if (manga === null) {
        return;
    }
    refreshMangaMetadataFor(manga, files, platform);
}
