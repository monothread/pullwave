import type { AnimeHistoryEntry, AnimeUpdateEntry } from '@shared/anime';
import type { MangaUpdateEntry, ReadingEntry } from '@shared/manga';
import type { HistoryEntry } from '@shared/types';

export function makeAnimeHistory(overrides: Partial<AnimeHistoryEntry> = {}): AnimeHistoryEntry {
    return { id: 1, title: 'Naruto', query: 'naruto', searchIndex: 1, audio: 'sub', episode: '1', openedAt: 1000, ...overrides };
}

export function makeAnimeUpdate(overrides: Partial<AnimeUpdateEntry> = {}): AnimeUpdateEntry {
    return { id: 1, animeId: 1, animeTitle: 'Naruto', audio: 'sub', episodeId: 10, episodeNumber: '5', foundAt: 2000, origin: 'auto', status: 'idle', ...overrides };
}

export function makeReading(overrides: Partial<ReadingEntry> = {}): ReadingEntry {
    return {
        id: 1,
        sourceId: '123',
        mangaRemoteId: 7,
        title: 'One Piece',
        thumbnailUrl: 'http://127.0.0.1:4321/api/v1/manga/7/thumbnail',
        chapterRemoteId: 11,
        chapterName: 'Romance Dawn',
        chapterNumber: 1,
        page: 4,
        pageCount: 20,
        readAt: 3000,
        libraryMangaId: 1,
        ...overrides
    };
}

export function makeMangaUpdate(overrides: Partial<MangaUpdateEntry> = {}): MangaUpdateEntry {
    return {
        id: 1,
        mangaId: 1,
        mangaTitle: 'One Piece',
        thumbnailUrl: 'http://127.0.0.1:4321/api/v1/manga/7/thumbnail',
        chapterId: 1,
        chapterRemoteId: 11,
        chapterName: 'Romance Dawn',
        chapterNumber: 1,
        dateUploaded: null,
        foundAt: 4000,
        origin: 'auto',
        status: 'idle',
        ...overrides
    };
}

export function makeVideoHistory(overrides: Partial<HistoryEntry> = {}): HistoryEntry {
    return { id: 'v1', url: 'https://example.com/v1', title: 'A video', filePath: '/d/a.mp4', status: 'done', errorTitle: null, finishedAt: 5000, ...overrides };
}
