import type {
    ExtensionAction,
    MangaChapter,
    MangaDetails,
    MangaDownloadRequest,
    MangaFilter,
    MangaListKind,
    MangaListRequest,
    MangaPreferenceChange,
    MangaReadRequest,
    MangaRetitleRequest,
    MangaSeriesRequest,
    MangaSourceMigrationRequest,
    MangaPreferenceType,
    MangaStatus,
    MangaSummary,
    ReadingRecord
} from '@shared/manga';
import { MAX_LOCAL_PAGES } from './localPages';
import { LOCAL_MANGA_SOURCE_ID, MANGA_LIST_KINDS, MANGA_STATUSES, MANGA_TRI_STATES, MAX_GROUP_NAME_LENGTH } from '@shared/manga';
import { cleanSeasonName, cleanSeriesName, isValidSeason } from '@shared/series';

export const MAX_TEXT = 500;
export const MAX_DESCRIPTION = 10_000;
export const MAX_URL = 2048;
export const MAX_CHAPTERS_PER_REQUEST = 20_000;
export const MAX_IDS = 20_000;
export const MAX_GENRES = 100;

type Raw = Record<string, unknown>;

function isRecord(value: unknown): value is Raw {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function asId(value: unknown): number | null {
    return typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= Number.MAX_SAFE_INTEGER ? value : null;
}

export function asLocalOrRemoteId(value: unknown): number | null {
    return typeof value === 'number' && Number.isSafeInteger(value) && value !== 0 ? value : null;
}

export function asPageIndex(value: unknown): number | null {
    return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value < MAX_LOCAL_PAGES ? value : null;
}

export function asIds(value: unknown): number[] {
    const ids = (Array.isArray(value) ? value.slice(0, MAX_IDS) : []).map(asId).filter((id): id is number => {
        return id !== null;
    });
    return [...new Set(ids)];
}

function text(value: unknown, max: number): string | null {
    return typeof value === 'string' && value.trim().length > 0 ? value.trim().slice(0, max) : null;
}

function optionalText(value: unknown, max: number): string | null {
    return text(value, max);
}

function finiteNumber(value: unknown): number | null {
    return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

export function asExtensionAction(value: unknown): ExtensionAction | null {
    return value === 'install' || value === 'uninstall' || value === 'update' ? value : null;
}

export function asPackageName(value: unknown): string | null {
    return typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._-]{0,200}$/.test(value) ? value : null;
}

export function asStoreUrl(value: unknown): string | null {
    const address = text(value, MAX_URL);
    if (address === null) {
        return null;
    }
    try {
        const url = new URL(address);
        return url.protocol === 'http:' || url.protocol === 'https:' ? url.toString() : null;
    } catch {
        return null;
    }
}

export function asSourceId(value: unknown): string | null {
    return typeof value === 'string' && /^-?\d{1,20}$/.test(value) ? value : null;
}

export function asListRequest(value: unknown): MangaListRequest | null {
    if (!isRecord(value)) {
        return null;
    }
    const sourceId = asSourceId(value['sourceId']);
    const kind = (MANGA_LIST_KINDS as readonly unknown[]).includes(value['kind']) ? (value['kind'] as MangaListKind) : null;
    const page = asId(value['page']);
    if (sourceId === null || kind === null || page === null) {
        return null;
    }
    const query = typeof value['query'] === 'string' ? value['query'].trim().slice(0, MAX_TEXT) : '';
    if (value['filters'] === undefined) {
        return { sourceId, kind, page, query };
    }
    const filters = asFilters(value['filters'], 1);
    return filters === null ? null : { sourceId, kind, page, query, filters };
}

export function asReadRequest(value: unknown): MangaReadRequest | null {
    if (!isRecord(value)) {
        return null;
    }
    const library = value['libraryChapterId'];
    const libraryChapterId = library === null || library === undefined ? null : asId(library);
    if (libraryChapterId === null && library !== null && library !== undefined) {
        return null;
    }
    const chapterRemoteId = libraryChapterId !== null ? asLocalOrRemoteId(value['chapterRemoteId']) : asId(value['chapterRemoteId']);
    if (chapterRemoteId === null) {
        return null;
    }
    return { chapterRemoteId, libraryChapterId };
}

export const MAX_FILTERS = 5000;
export const MAX_FILTER_DEPTH = 2;

function integerIn(value: unknown, max: number): number | null {
    return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= max ? value : null;
}

function asFilter(value: unknown, depth: number): MangaFilter | null {
    if (!isRecord(value) || typeof value['name'] !== 'string') {
        return null;
    }
    const name = value['name'].slice(0, MAX_TEXT);
    switch (value['type']) {
        case 'header':
        case 'separator':
            return { type: value['type'], name };
        case 'text':
            return typeof value['value'] === 'string' && value['value'].length <= MAX_TEXT ? { type: 'text', name, value: value['value'] } : null;
        case 'checkbox':
            return typeof value['value'] === 'boolean' ? { type: 'checkbox', name, value: value['value'] } : null;
        case 'tristate':
            return (MANGA_TRI_STATES as readonly unknown[]).includes(value['value']) ? { type: 'tristate', name, value: value['value'] as (typeof MANGA_TRI_STATES)[number] } : null;
        case 'select': {
            const selected = integerIn(value['value'], MAX_FILTERS);
            return selected === null ? null : { type: 'select', name, options: [], value: selected };
        }
        case 'sort': {
            const state = value['value'];
            const index = isRecord(state) ? integerIn(state['index'], MAX_FILTERS) : null;
            return index !== null && isRecord(state) && typeof state['ascending'] === 'boolean' ? { type: 'sort', name, options: [], value: { index, ascending: state['ascending'] } } : null;
        }
        case 'group': {
            const inner = depth >= MAX_FILTER_DEPTH ? [] : asFilters(value['filters'], depth + 1);
            return inner === null ? null : { type: 'group', name, filters: inner };
        }
        default:
            return null;
    }
}

function asFilters(value: unknown, depth: number): MangaFilter[] | null {
    if (!Array.isArray(value) || value.length > MAX_FILTERS) {
        return null;
    }
    const filters: MangaFilter[] = [];
    for (const entry of value) {
        const filter = asFilter(entry, depth);
        if (filter === null) {
            return null;
        }
        filters.push(filter);
    }
    return filters;
}

function asSummary(value: unknown): MangaSummary | null {
    if (!isRecord(value)) {
        return null;
    }
    const remoteId = asId(value['remoteId']);
    const sourceId = asSourceId(value['sourceId']);
    const title = text(value['title'], MAX_TEXT);
    if (remoteId === null || sourceId === null || title === null) {
        return null;
    }
    return { remoteId, sourceId, title, thumbnailUrl: optionalText(value['thumbnailUrl'], MAX_URL) };
}

function asDetails(value: unknown, summary: MangaSummary): MangaDetails | null {
    if (!isRecord(value)) {
        return null;
    }
    const genres = (Array.isArray(value['genres']) ? value['genres'].slice(0, MAX_GENRES) : [])
        .map((genre) => {
            return optionalText(genre, MAX_TEXT);
        })
        .filter((genre): genre is string => {
            return genre !== null;
        });
    const status = (MANGA_STATUSES as readonly unknown[]).includes(value['status']) ? (value['status'] as MangaStatus) : 'unknown';
    return {
        ...summary,
        url: asStoreUrl(value['url']),
        author: optionalText(value['author'], MAX_TEXT),
        artist: optionalText(value['artist'], MAX_TEXT),
        description: optionalText(value['description'], MAX_DESCRIPTION),
        genres,
        status
    };
}

function asChapter(value: unknown): MangaChapter | null {
    if (!isRecord(value)) {
        return null;
    }
    const remoteId = asId(value['remoteId']);
    if (remoteId === null) {
        return null;
    }
    const date = finiteNumber(value['dateUploaded']);
    const order = value['sourceOrder'];
    return {
        remoteId,
        name: optionalText(value['name'], MAX_TEXT) ?? '',
        number: finiteNumber(value['number']),
        dateUploaded: date !== null && date > 0 ? date : null,
        scanlator: optionalText(value['scanlator'], MAX_TEXT),
        sourceOrder: typeof order === 'number' && Number.isInteger(order) ? order : 0
    };
}

export function asDownloadRequest(value: unknown): MangaDownloadRequest | null {
    if (!isRecord(value)) {
        return null;
    }
    const manga = asSummary(value['manga']);
    if (manga === null || !Array.isArray(value['chapters'])) {
        return null;
    }
    const chapters = value['chapters']
        .slice(0, MAX_CHAPTERS_PER_REQUEST)
        .map(asChapter)
        .filter((chapter): chapter is MangaChapter => {
            return chapter !== null;
        });
    if (chapters.length === 0) {
        return null;
    }
    return { manga, details: asDetails(value['details'], manga), chapters };
}

export function asSeriesRequest(value: unknown): MangaSeriesRequest | null {
    if (!isRecord(value)) {
        return null;
    }
    const mangaId = asId(value['mangaId']);
    if (mangaId === null) {
        return null;
    }
    if (value['series'] === null) {
        return { mangaId, series: null, season: null, seasonName: null };
    }
    const series = typeof value['series'] === 'string' ? cleanSeriesName(value['series']) : null;
    const seasonName = value['seasonName'] === null || value['seasonName'] === undefined ? null : typeof value['seasonName'] === 'string' ? cleanSeasonName(value['seasonName']) : undefined;
    if (series === null || !isValidSeason(value['season']) || seasonName === undefined) {
        return null;
    }
    return { mangaId, series, season: value['season'], seasonName };
}

export function asGroupName(value: unknown): string | null {
    if (typeof value !== 'string') {
        return null;
    }
    const cleaned = value.replace(/\s+/g, ' ').trim();
    return cleaned.length > 0 && cleaned.length <= MAX_GROUP_NAME_LENGTH ? cleaned : null;
}

export function asSourceMigrationRequest(value: unknown): MangaSourceMigrationRequest | null {
    if (!isRecord(value)) {
        return null;
    }
    const mangaId = asId(value['mangaId']);
    const target = asDownloadRequest(value['target']);
    return mangaId === null || target === null ? null : { mangaId, target };
}

export function asRetitleRequest(value: unknown): MangaRetitleRequest | null {
    if (!isRecord(value)) {
        return null;
    }
    const mangaId = asId(value['mangaId']);
    const title = text(value['title'], MAX_TEXT);
    return mangaId === null || title === null ? null : { mangaId, title };
}

export const MAX_PAGES = 5000;

export function asReadingRecord(value: unknown, allowLocalChapter = false): ReadingRecord | null {
    if (!isRecord(value)) {
        return null;
    }
    const sourceId = text(value['sourceId'], MAX_TEXT);
    const mangaRemoteId = sourceId === LOCAL_MANGA_SOURCE_ID ? asLocalOrRemoteId(value['mangaRemoteId']) : asId(value['mangaRemoteId']);
    const title = text(value['title'], MAX_TEXT);
    const chapterRemoteId = sourceId === LOCAL_MANGA_SOURCE_ID || allowLocalChapter ? asLocalOrRemoteId(value['chapterRemoteId']) : asId(value['chapterRemoteId']);
    const page = value['page'];
    const pageCount = value['pageCount'];
    if (
        sourceId === null ||
        mangaRemoteId === null ||
        title === null ||
        chapterRemoteId === null ||
        typeof page !== 'number' ||
        typeof pageCount !== 'number' ||
        !Number.isInteger(page) ||
        !Number.isInteger(pageCount) ||
        pageCount < 1 ||
        pageCount > MAX_PAGES ||
        page < 0 ||
        page >= pageCount
    ) {
        return null;
    }
    const chapterNumber = value['chapterNumber'];
    return {
        sourceId,
        mangaRemoteId,
        title,
        thumbnailUrl: optionalText(value['thumbnailUrl'], MAX_URL),
        chapterRemoteId,
        chapterName: typeof value['chapterName'] === 'string' ? value['chapterName'].trim().slice(0, MAX_TEXT) : '',
        chapterNumber: finiteNumber(chapterNumber),
        page,
        pageCount
    };
}

const PREFERENCE_TYPES: readonly MangaPreferenceType[] = ['text', 'list', 'switch', 'checkbox', 'multiselect'];
export const MAX_PREFERENCE_TEXT = 10_000;
export const MAX_PREFERENCE_CHOICES = 1000;

function asPreferenceValue(type: MangaPreferenceType, value: unknown): MangaPreferenceChange['value'] | null {
    if (type === 'switch' || type === 'checkbox') {
        return typeof value === 'boolean' ? value : null;
    }
    if (type === 'multiselect') {
        if (!Array.isArray(value) || value.length > MAX_PREFERENCE_CHOICES || value.some((item) => {
            return typeof item !== 'string' || item.length > MAX_PREFERENCE_TEXT;
        })) {
            return null;
        }
        return value as string[];
    }
    return typeof value === 'string' && value.length <= MAX_PREFERENCE_TEXT ? value : null;
}

export function asPreferenceChange(value: unknown): MangaPreferenceChange | null {
    if (!isRecord(value)) {
        return null;
    }
    const sourceId = asSourceId(value['sourceId']);
    const position = value['position'];
    const type = PREFERENCE_TYPES.find((candidate) => {
        return candidate === value['type'];
    });
    if (sourceId === null || typeof position !== 'number' || !Number.isInteger(position) || position < 0 || position > MAX_PREFERENCE_CHOICES || type === undefined) {
        return null;
    }
    const checked = asPreferenceValue(type, value['value']);
    return checked === null ? null : { sourceId, position, type, value: checked };
}
