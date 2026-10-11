import type {
    LibraryManga,
    MangaChapter,
    MangaChapterRecord,
    MangaDetails,
    MangaExtension,
    MangaJob,
    MangaSource,
    MangaStatusInfo,
    MangaSummary
} from '@shared/manga';
import type { ToolState } from '@shared/tools';

export const READY_TOOL: ToolState = { id: 'suwayomi', status: 'ready', version: 'v2.4.2366', bytesDone: 0, bytesTotal: 0, percent: 100, error: null };

export function makeMangaStatus(overrides: Partial<MangaStatusInfo> = {}): MangaStatusInfo {
    return { supported: true, tool: READY_TOOL, helper: null, helperProblem: null, helperExternal: false, server: 'running', serverError: null, ...overrides };
}

export function makeTool(overrides: Partial<ToolState> = {}): ToolState {
    return { ...READY_TOOL, ...overrides };
}

export function makeSummary(overrides: Partial<MangaSummary> = {}): MangaSummary {
    return { remoteId: 7, sourceId: '123', title: 'One Piece', thumbnailUrl: 'http://127.0.0.1:4321/api/v1/manga/7/thumbnail', ...overrides };
}

export function makeDetails(overrides: Partial<MangaDetails> = {}): MangaDetails {
    return {
        ...makeSummary(),
        url: 'https://dex.example/manga/one-piece',
        author: 'Oda',
        artist: 'Oda E.',
        description: 'Pirates search for a treasure.',
        genres: ['Action', 'Adventure'],
        status: 'ongoing',
        ...overrides
    };
}

export function makeChapter(overrides: Partial<MangaChapter> = {}): MangaChapter {
    return { remoteId: 11, name: 'Romance Dawn', number: 1, dateUploaded: 1700000000000, scanlator: 'Group A', sourceOrder: 99, ...overrides };
}

export function makeChapterRecord(overrides: Partial<MangaChapterRecord> = {}): MangaChapterRecord {
    return {
        id: 1,
        mangaId: 1,
        remoteId: 11,
        name: 'Romance Dawn',
        number: 1,
        dateUploaded: null,
        scanlator: null,
        sourceOrder: 99,
        status: 'done',
        pageCount: 20,
        filePath: '/m/One Piece/Chapter 1.cbz',
        sizeBytes: 4096,
        error: null,
        downloadedAt: 1,
        ...overrides
    };
}

export function makeLibraryManga(chapters: MangaChapterRecord[], overrides: Partial<LibraryManga> = {}): LibraryManga {
    return {
        id: 1,
        sourceId: '123',
        remoteId: 7,
        title: 'One Piece',
        thumbnailUrl: 'http://127.0.0.1:4321/api/v1/manga/7/thumbnail',
        url: null,
        author: null,
        artist: null,
        description: null,
        genres: [],
        status: 'unknown',
        createdAt: 1,
        series: null,
        season: null,
        seasonName: null,
        groupIds: [],
        chapters,
        ...overrides
    };
}

export function makeMangaJob(overrides: Partial<MangaJob> = {}): MangaJob {
    return {
        chapterId: 1,
        mangaId: 1,
        mangaTitle: 'One Piece',
        chapterName: 'Romance Dawn',
        sourceId: '123',
        status: 'running',
        pagesDone: 5,
        pageCount: 20,
        percent: 25,
        error: null,
        ...overrides
    };
}

export function makeExtension(overrides: Partial<MangaExtension> = {}): MangaExtension {
    return {
        pkgName: 'eu.kanade.tachiyomi.extension.en.mangadex',
        name: 'Tachiyomi: MangaDex',
        lang: 'en',
        versionName: '1.4.2',
        isInstalled: false,
        hasUpdate: false,
        isObsolete: false,
        iconUrl: null,
        contentWarning: 'SAFE',
        storeIndexUrl: 'https://store.example/index.min.json',
        extensionLib: '1.4',
        isCompatible: true,
        ...overrides
    };
}

export function makeSource(overrides: Partial<MangaSource> = {}): MangaSource {
    return { id: '123', name: 'MangaDex', lang: 'en', iconUrl: null, supportsLatest: true, isConfigurable: false, contentWarning: 'SAFE', extensionPkg: 'eu.kanade.tachiyomi.extension.en.mangadex', storeIndexUrl: 'https://store.example/index.min.json', ...overrides };
}
