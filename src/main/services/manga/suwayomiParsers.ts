import {
    CONTENT_WARNINGS,
    MANGA_TRI_STATES,
    isExtensionLibSupported,
    type ContentWarning,
    type MangaChapter,
    type MangaDetails,
    type MangaExtension,
    type MangaExtensionStore,
    type MangaFilter,
    type MangaListing,
    type MangaSource,
    type MangaSourcePreference,
    type MangaStatus,
    type MangaSummary,
    type MangaTriState
} from '@shared/manga';

// What the server answers is data that came from a site through an extension: it is checked and cut to size before the app uses it.
export class ParseError extends Error {}

export const MAX_TEXT_LENGTH = 500;
export const MAX_DESCRIPTION_LENGTH = 10_000;
export const MAX_URL_LENGTH = 2048;
export const MAX_ITEMS = 5000;
export const MAX_CHAPTERS = 20_000;
export const MAX_PAGES = 3000;
export const MAX_GENRES = 100;

type Raw = Record<string, unknown>;

export function record(value: unknown, what: string): Raw {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        throw new ParseError(`${what} must be an object`);
    }
    return value as Raw;
}

export function list(value: unknown, what: string, max: number): unknown[] {
    if (!Array.isArray(value)) {
        throw new ParseError(`${what} must be a list`);
    }
    return value.slice(0, max);
}

function requiredText(value: unknown, what: string, max = MAX_TEXT_LENGTH): string {
    if (typeof value !== 'string' || value.trim().length === 0) {
        throw new ParseError(`${what} must be a text`);
    }
    return value.trim().slice(0, max);
}

function optionalText(value: unknown, max = MAX_TEXT_LENGTH): string | null {
    return typeof value === 'string' && value.trim().length > 0 ? value.trim().slice(0, max) : null;
}

function integer(value: unknown, what: string): number {
    if (typeof value !== 'number' || !Number.isInteger(value)) {
        throw new ParseError(`${what} must be a whole number`);
    }
    return value;
}

// A number the server sends as text because it does not fit in 32 bits ("LongString").
function longNumber(value: unknown): number | null {
    const parsed = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : Number.NaN;
    return Number.isFinite(parsed) ? parsed : null;
}

// An address from the server: one of its own paths (relative to it) or an http(s) address; anything else is dropped.
export function resolveAddress(value: unknown, baseUrl: string): string | null {
    const text = optionalText(value, MAX_URL_LENGTH);
    if (text === null) {
        return null;
    }
    try {
        const resolved = new URL(text, `${baseUrl}/`);
        return resolved.protocol === 'http:' || resolved.protocol === 'https:' ? resolved.toString() : null;
    } catch {
        return null;
    }
}

function parseContentWarning(value: unknown): ContentWarning {
    return (CONTENT_WARNINGS as readonly unknown[]).includes(value) ? (value as ContentWarning) : 'SAFE';
}

const STATUS_BY_SERVER: Readonly<Record<string, MangaStatus>> = {
    ONGOING: 'ongoing',
    PUBLISHING_FINISHED: 'completed',
    COMPLETED: 'completed',
    ON_HIATUS: 'hiatus',
    CANCELLED: 'cancelled'
};

export function parseStatus(value: unknown): MangaStatus {
    return typeof value === 'string' ? (STATUS_BY_SERVER[value] ?? 'unknown') : 'unknown';
}

export function parseStore(value: unknown): MangaExtensionStore {
    const raw = record(value, 'A store');
    const indexUrl = requiredText(raw['indexUrl'], 'The address of a store', MAX_URL_LENGTH);
    return { indexUrl, name: optionalText(raw['name']) ?? indexUrl };
}

export function parseExtension(value: unknown, baseUrl: string): MangaExtension {
    const raw = record(value, 'An extension');
    const extensionLib = optionalText(raw['extensionLib']);
    return {
        pkgName: requiredText(raw['pkgName'], 'The package of an extension'),
        name: requiredText(raw['name'], 'The name of an extension'),
        lang: optionalText(raw['lang']) ?? 'all',
        versionName: optionalText(raw['versionName']) ?? '',
        isInstalled: raw['isInstalled'] === true,
        hasUpdate: raw['hasUpdate'] === true,
        isObsolete: raw['isObsolete'] === true,
        iconUrl: resolveAddress(raw['iconUrl'], baseUrl),
        contentWarning: parseContentWarning(raw['contentWarning']),
        storeIndexUrl: optionalText(raw['storeIndexUrl'], MAX_URL_LENGTH),
        extensionLib,
        isCompatible: isExtensionLibSupported(extensionLib)
    };
}

export function parseSource(value: unknown, baseUrl: string): MangaSource {
    const raw = record(value, 'A source');
    const extension = typeof raw['extension'] === 'object' && raw['extension'] !== null ? (raw['extension'] as Raw) : null;
    const name = requiredText(raw['displayName'] ?? raw['name'], 'The name of a source');
    return {
        id: requiredText(raw['id'], 'The id of a source'),
        name,
        lang: optionalText(raw['lang']) ?? 'all',
        iconUrl: resolveAddress(raw['iconUrl'], baseUrl),
        supportsLatest: raw['supportsLatest'] === true,
        isConfigurable: raw['isConfigurable'] === true,
        contentWarning: parseContentWarning(raw['contentWarning']),
        extensionPkg: extension === null ? null : optionalText(extension['pkgName']),
        storeIndexUrl: extension === null ? null : optionalText(extension['storeIndexUrl'], MAX_URL_LENGTH)
    };
}

export function parseSummary(value: unknown, baseUrl: string): MangaSummary {
    const raw = record(value, 'A manga');
    return {
        remoteId: integer(raw['id'], 'The id of a manga'),
        sourceId: requiredText(raw['sourceId'], 'The source of a manga'),
        title: requiredText(raw['title'], 'The title of a manga'),
        thumbnailUrl: resolveAddress(raw['thumbnailUrl'], baseUrl)
    };
}

export function parseDetails(value: unknown, baseUrl: string): MangaDetails {
    const raw = record(value, 'A manga');
    const genres = Array.isArray(raw['genre']) ? raw['genre'] : [];
    return {
        ...parseSummary(raw, baseUrl),
        author: optionalText(raw['author']),
        artist: optionalText(raw['artist']),
        description: optionalText(raw['description'], MAX_DESCRIPTION_LENGTH),
        genres: genres
            .slice(0, MAX_GENRES)
            .map((genre) => {
                return optionalText(genre);
            })
            .filter((genre): genre is string => {
                return genre !== null;
            }),
        status: parseStatus(raw['status'])
    };
}

export function parseListing(items: unknown, hasNextPage: unknown, baseUrl: string): MangaListing {
    return {
        items: list(items, 'The mangas', MAX_ITEMS).map((item) => {
            return parseSummary(item, baseUrl);
        }),
        hasNextPage: hasNextPage === true
    };
}

export function parseChapter(value: unknown): MangaChapter {
    const raw = record(value, 'A chapter');
    const number = typeof raw['chapterNumber'] === 'number' && Number.isFinite(raw['chapterNumber']) && raw['chapterNumber'] >= 0 ? raw['chapterNumber'] : null;
    const date = longNumber(raw['uploadDate']);
    return {
        remoteId: integer(raw['id'], 'The id of a chapter'),
        name: optionalText(raw['name']) ?? '',
        number,
        dateUploaded: date !== null && date > 0 ? date : null,
        scanlator: optionalText(raw['scanlator']),
        sourceOrder: typeof raw['sourceOrder'] === 'number' && Number.isInteger(raw['sourceOrder']) ? raw['sourceOrder'] : 0
    };
}

// The chapters of a manga, the newest first (the server gives them in the order its source does, which is not always the same).
export function parseChapters(value: unknown): MangaChapter[] {
    return list(value, 'The chapters', MAX_CHAPTERS)
        .map(parseChapter)
        .sort((first, second) => {
            return second.sourceOrder - first.sourceOrder;
        });
}

// The addresses of the pages of a chapter, as the server serves them.
export function parsePageAddresses(value: unknown, baseUrl: string): string[] {
    return list(value, 'The pages', MAX_PAGES).map((page) => {
        const address = resolveAddress(page, baseUrl);
        if (address === null) {
            throw new ParseError('A page has no usable address');
        }
        return address;
    });
}

function textList(value: unknown): string[] {
    return (Array.isArray(value) ? value.slice(0, MAX_ITEMS) : []).filter((item): item is string => {
        return typeof item === 'string';
    });
}

function parsePreference(raw: Raw, position: number): MangaSourcePreference | null {
    const base = {
        position,
        key: requiredText(raw['key'], 'The key of a setting', 1000),
        title: optionalText(raw['title'], 1000) ?? optionalText(raw['key'], 1000) ?? '',
        summary: optionalText(raw['summary'], 1000) ?? '',
        enabled: raw['enabled'] !== false
    };
    switch (raw['__typename']) {
        case 'EditTextPreference':
            return { ...base, type: 'text', value: typeof raw['editValue'] === 'string' ? raw['editValue'] : '' };
        case 'ListPreference':
            return { ...base, type: 'list', value: typeof raw['listValue'] === 'string' ? raw['listValue'] : '', entries: textList(raw['entries']), entryValues: textList(raw['entryValues']) };
        case 'SwitchPreference':
            return { ...base, type: 'switch', value: raw['switchValue'] === true };
        case 'CheckBoxPreference':
            return { ...base, type: 'checkbox', value: raw['checkValue'] === true };
        case 'MultiSelectListPreference':
            return { ...base, type: 'multiselect', value: textList(raw['multiValue']), entries: textList(raw['entries']), entryValues: textList(raw['entryValues']) };
        default:
            return null;
    }
}

// The settings of a source that are shown to the user: the hidden ones and the kinds this app does not know are left out (their place in
// the list is kept by the others, since a change names a setting by its place).
export function parsePreferences(value: unknown): MangaSourcePreference[] {
    const preferences: MangaSourcePreference[] = [];
    list(value, 'The settings', MAX_ITEMS).forEach((entry, position) => {
        const raw = record(entry, 'A setting');
        if (raw['visible'] === false) {
            return;
        }
        const preference = parsePreference(raw, position);
        if (preference !== null) {
            preferences.push(preference);
        }
    });
    return preferences;
}

export const MAX_FILTER_DEPTH = 2;

function filterName(value: unknown): string {
    return typeof value === 'string' ? value.trim().slice(0, MAX_TEXT_LENGTH) : '';
}

function parseFilter(raw: Raw, depth: number): MangaFilter {
    const name = filterName(raw['name']);
    switch (raw['__typename']) {
        case 'HeaderFilter':
            return { type: 'header', name };
        case 'TextFilter':
            return { type: 'text', name, value: typeof raw['textValue'] === 'string' ? raw['textValue'].slice(0, MAX_TEXT_LENGTH) : '' };
        case 'CheckBoxFilter':
            return { type: 'checkbox', name, value: raw['checkValue'] === true };
        case 'TriStateFilter': {
            const state = typeof raw['triValue'] === 'string' ? raw['triValue'].toLowerCase() : '';
            return { type: 'tristate', name, value: (MANGA_TRI_STATES as readonly string[]).includes(state) ? (state as MangaTriState) : 'ignore' };
        }
        case 'SelectFilter': {
            const options = textList(raw['values']);
            const value = raw['selectValue'];
            return { type: 'select', name, options, value: typeof value === 'number' && Number.isInteger(value) && value >= 0 && value < options.length ? value : 0 };
        }
        case 'SortFilter': {
            const options = textList(raw['sortOptions']);
            const state = raw['sortValue'];
            const chosen = typeof state === 'object' && state !== null ? (state as Raw) : {};
            const index = chosen['index'];
            return {
                type: 'sort',
                name,
                options,
                value: { index: typeof index === 'number' && Number.isInteger(index) && index >= 0 && index < options.length ? index : 0, ascending: chosen['ascending'] === true }
            };
        }
        case 'GroupFilter':
            return { type: 'group', name, filters: depth >= MAX_FILTER_DEPTH ? [] : parseFilters(raw['filters'], depth + 1) };
        default:
            // Separators, and the kinds this app does not know: the place they take in the list is kept, since a change names a filter by it.
            return { type: 'separator', name };
    }
}

// The filters a source offers for its search. Every entry is kept, so that the place of a filter in the list is the one the server knows.
export function parseFilters(value: unknown, depth = 1): MangaFilter[] {
    return list(value, 'The filters', MAX_ITEMS).map((entry) => {
        return parseFilter(record(entry, 'A filter'), depth);
    });
}
