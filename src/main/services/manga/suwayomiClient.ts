import type { ErrorDetails } from '@shared/errorDetails';
import type {
    MangaChapter,
    MangaDetails,
    MangaDetailsWithChapters,
    MangaErrorCode,
    MangaExtension,
    MangaExtensionStore,
    MangaFilter,
    MangaListing,
    MangaListRequest,
    MangaPreferenceChange,
    MangaSource,
    MangaSourcePreference
} from '@shared/manga';
import { describeError } from '../errorDetails';
import {
    list,
    ParseError,
    parseChapters,
    parseDetails,
    parseExtension,
    parseFilters,
    parseListing,
    parsePageAddresses,
    parsePreferences,
    parseSource,
    parseStore,
    record
} from './suwayomiParsers';

export const REQUEST_TIMEOUT_MS = 60_000;
export const SOURCE_TIMEOUT_MS = 180_000;

export class SuwayomiApiError extends Error {
    constructor(
        readonly code: MangaErrorCode,
        message: string,
        readonly known: Partial<ErrorDetails> = {}
    ) {
        super(message);
    }
}

export function operationOf(query: string): string {
    return /\{\s*(\w+)/.exec(query)?.[1] ?? 'unnamed request';
}

export interface SuwayomiClientDependencies {
    baseUrl: () => Promise<string>;
    fetchImpl?: typeof fetch;
    retryDelayMs?: number;
}

export const CHALLENGE_RETRIES = 2;
export const CHALLENGE_RETRY_DELAY_MS = 1000;
const REFUSED = /HTTP error 403\b/;

const EXTENSION_FIELDS = 'pkgName name lang versionName isInstalled hasUpdate isObsolete iconUrl contentWarning storeIndexUrl extensionLib';
const SOURCE_FIELDS = 'id name displayName lang iconUrl supportsLatest isConfigurable contentWarning extension { pkgName storeIndexUrl }';
const MANGA_FIELDS = 'id sourceId title thumbnailUrl';
const MANGA_DETAIL_FIELDS = `${MANGA_FIELDS} realUrl author artist description genre status`;
const PREFERENCE_FIELDS = `__typename
    ... on EditTextPreference { key title summary visible enabled editValue: currentValue }
    ... on ListPreference { key title summary visible enabled listValue: currentValue entries entryValues }
    ... on SwitchPreference { key title summary visible enabled switchValue: currentValue }
    ... on CheckBoxPreference { key title summary visible enabled checkValue: currentValue }
    ... on MultiSelectListPreference { key title summary visible enabled multiValue: currentValue entries entryValues }`;
const FILTER_LEAF = `__typename
    ... on HeaderFilter { name }
    ... on SeparatorFilter { name }
    ... on TextFilter { name textValue: default }
    ... on CheckBoxFilter { name checkValue: default }
    ... on TriStateFilter { name triValue: default }
    ... on SelectFilter { name selectValue: default values }
    ... on SortFilter { name sortOptions: values sortValue: default { index ascending } }`;
const FILTER_FIELDS = `${FILTER_LEAF}
    ... on GroupFilter { name filters { ${FILTER_LEAF} } }`;
const CHAPTER_FIELDS = 'id name chapterNumber uploadDate scanlator sourceOrder';

export const QUERIES = {
    about: '{ aboutServer { version } }',
    stores: '{ extensionStores { nodes { name indexUrl } } }',
    addStore: 'mutation ($indexUrl: String!) { addExtensionStore(input: { indexUrl: $indexUrl }) { extensionStore { name indexUrl } } }',
    removeStore: 'mutation ($indexUrl: String!) { removeExtensionStore(input: { indexUrl: $indexUrl }) { extensionStore { name indexUrl } } }',
    refreshExtensions: `mutation { fetchExtensions(input: {}) { extensions { ${EXTENSION_FIELDS} } } }`,
    extensions: `{ extensions { nodes { ${EXTENSION_FIELDS} } } }`,
    updateExtension: `mutation ($id: String!, $patch: UpdateExtensionPatchInput!) { updateExtension(input: { id: $id, patch: $patch }) { extension { ${EXTENSION_FIELDS} } } }`,
    updateExtensions: `mutation ($ids: [String!]!) { updateExtensions(input: { ids: $ids, patch: { update: true } }) { extensions { ${EXTENSION_FIELDS} } } }`,
    sources: `{ sources { nodes { ${SOURCE_FIELDS} } } }`,
    sourcePreferences: `query ($id: LongString!) { source(id: $id) { preferences { ${PREFERENCE_FIELDS} } } }`,
    sourceFilters: `query ($id: LongString!) { source(id: $id) { filters { ${FILTER_FIELDS} } } }`,
    setSourcePreference: `mutation ($source: LongString!, $change: SourcePreferenceChangeInput!) {
        updateSourcePreference(input: { source: $source, change: $change }) { preferences { ${PREFERENCE_FIELDS} } }
    }`,
    list: `mutation ($source: LongString!, $type: FetchSourceMangaType!, $page: Int!, $query: String, $filters: [FilterChangeInput!]) {
        fetchSourceManga(input: { source: $source, type: $type, page: $page, query: $query, filters: $filters }) { hasNextPage mangas { ${MANGA_FIELDS} } }
    }`,
    mangaWithChapters: `mutation ($id: Int!) {
        fetchMangaAndChapters(input: { id: $id, fetchManga: true, fetchChapters: true }) { manga { ${MANGA_DETAIL_FIELDS} } chapters { ${CHAPTER_FIELDS} } }
    }`,
    chaptersByIds: `query ($ids: [Int!]) { chapters(filter: { id: { in: $ids } }) { nodes { ${CHAPTER_FIELDS} } } }`,
    setFlareSolverr: `mutation ($settings: PartialSettingsTypeInput!) { setSettings(input: { settings: $settings }) { settings { flareSolverrEnabled flareSolverrUrl } } }`,
    chapterPages: 'mutation ($chapterId: Int!) { fetchChapterPages(input: { chapterId: $chapterId }) { pages } }'
} as const;

function preferenceChange(change: MangaPreferenceChange): Record<string, unknown> {
    const FIELDS = { text: 'editTextState', list: 'listState', switch: 'switchState', checkbox: 'checkBoxState', multiselect: 'multiSelectState' } as const;
    return { position: change.position, [FIELDS[change.type]]: change.value };
}

export function filterChanges(filters: MangaFilter[]): Array<Record<string, unknown>> {
    const changes: Array<Record<string, unknown>> = [];
    filters.forEach((filter, position) => {
        switch (filter.type) {
            case 'text':
                changes.push({ position, textState: filter.value });
                break;
            case 'checkbox':
                changes.push({ position, checkBoxState: filter.value });
                break;
            case 'tristate':
                changes.push({ position, triState: filter.value.toUpperCase() });
                break;
            case 'select':
                changes.push({ position, selectState: filter.value });
                break;
            case 'sort':
                changes.push({ position, sortState: { index: filter.value.index, ascending: filter.value.ascending } });
                break;
            case 'group':
                filterChanges(filter.filters).forEach((inner) => {
                    changes.push({ position, groupChange: inner });
                });
                break;
            default:
                break;
        }
    });
    return changes;
}

const LIST_TYPE = { popular: 'POPULAR', latest: 'LATEST', search: 'SEARCH' } as const;

interface GraphqlAnswer {
    data?: unknown;
    errors?: Array<{ message?: unknown }>;
}

export class SuwayomiClient {
    constructor(private readonly deps: SuwayomiClientDependencies) {}

    async setFlareSolverr(address: string | null): Promise<void> {
        await this.request(QUERIES.setFlareSolverr, { settings: address === null ? { flareSolverrEnabled: false } : { flareSolverrEnabled: true, flareSolverrUrl: address, flareSolverrAsResponseFallback: true } });
    }

    async serverVersion(): Promise<string | null> {
        const data = await this.request(QUERIES.about, {});
        return this.parsed(() => {
            const version = record(record(data, 'The answer')['aboutServer'], 'The server')['version'];
            return typeof version === 'string' && version.length > 0 ? version.slice(0, 40) : null;
        });
    }

    async stores(): Promise<MangaExtensionStore[]> {
        const data = await this.request(QUERIES.stores, {});
        return this.parsed(() => {
            return list(record(record(data, 'The answer')['extensionStores'], 'The stores')['nodes'], 'The stores', 1000).map(parseStore);
        });
    }

    async addStore(indexUrl: string): Promise<MangaExtensionStore> {
        const data = await this.request(QUERIES.addStore, { indexUrl });
        return this.parsed(() => {
            return parseStore(record(record(data, 'The answer')['addExtensionStore'], 'The answer')['extensionStore']);
        });
    }

    async removeStore(indexUrl: string): Promise<void> {
        await this.request(QUERIES.removeStore, { indexUrl });
    }

    async refreshExtensions(): Promise<MangaExtension[]> {
        const data = await this.request(QUERIES.refreshExtensions, {}, SOURCE_TIMEOUT_MS);
        const baseUrl = await this.deps.baseUrl();
        return this.parsed(() => {
            return list(record(record(data, 'The answer')['fetchExtensions'], 'The answer')['extensions'], 'The extensions', 20_000).map((extension) => {
                return parseExtension(extension, baseUrl);
            });
        });
    }

    async extensions(): Promise<MangaExtension[]> {
        const data = await this.request(QUERIES.extensions, {});
        const baseUrl = await this.deps.baseUrl();
        return this.parsed(() => {
            return list(record(record(data, 'The answer')['extensions'], 'The extensions')['nodes'], 'The extensions', 20_000).map((extension) => {
                return parseExtension(extension, baseUrl);
            });
        });
    }

    async changeExtension(pkgName: string, action: 'install' | 'uninstall' | 'update'): Promise<void> {
        await this.request(QUERIES.updateExtension, { id: pkgName, patch: { [action]: true } }, SOURCE_TIMEOUT_MS);
    }

    async updateExtensions(pkgNames: string[]): Promise<void> {
        await this.request(QUERIES.updateExtensions, { ids: pkgNames }, SOURCE_TIMEOUT_MS * 3);
    }

    async sources(): Promise<MangaSource[]> {
        const data = await this.request(QUERIES.sources, {});
        const baseUrl = await this.deps.baseUrl();
        return this.parsed(() => {
            return list(record(record(data, 'The answer')['sources'], 'The sources')['nodes'], 'The sources', 20_000).map((source) => {
                return parseSource(source, baseUrl);
            });
        });
    }

    async sourcePreferences(sourceId: string): Promise<MangaSourcePreference[]> {
        const data = await this.request(QUERIES.sourcePreferences, { id: sourceId });
        return this.parsed(() => {
            return parsePreferences(record(record(data, 'The answer')['source'], 'The source')['preferences']);
        });
    }

    async sourceFilters(sourceId: string): Promise<MangaFilter[]> {
        const data = await this.request(QUERIES.sourceFilters, { id: sourceId });
        return this.parsed(() => {
            return parseFilters(record(record(data, 'The answer')['source'], 'The source')['filters']);
        });
    }

    async setSourcePreference(change: MangaPreferenceChange): Promise<MangaSourcePreference[]> {
        const data = await this.request(QUERIES.setSourcePreference, { source: change.sourceId, change: preferenceChange(change) });
        return this.parsed(() => {
            return parsePreferences(record(record(data, 'The answer')['updateSourcePreference'], 'The answer')['preferences']);
        });
    }

    async list(request: MangaListRequest): Promise<MangaListing> {
        const data = await this.request(
            QUERIES.list,
            {
                source: request.sourceId,
                type: LIST_TYPE[request.kind],
                page: request.page,
                query: request.kind === 'search' ? request.query : null,
                filters: request.kind === 'search' && request.filters !== undefined && request.filters.length > 0 ? filterChanges(request.filters) : null
            },
            SOURCE_TIMEOUT_MS
        );
        const baseUrl = await this.deps.baseUrl();
        return this.parsed(() => {
            const payload = record(record(data, 'The answer')['fetchSourceManga'], 'The answer');
            return parseListing(payload['mangas'], payload['hasNextPage'], baseUrl);
        });
    }

    async mangaWithChapters(remoteId: number): Promise<MangaDetailsWithChapters> {
        const data = await this.request(QUERIES.mangaWithChapters, { id: remoteId }, SOURCE_TIMEOUT_MS);
        const baseUrl = await this.deps.baseUrl();
        return this.parsed(() => {
            const payload = record(record(data, 'The answer')['fetchMangaAndChapters'], 'The answer');
            const details: MangaDetails = parseDetails(payload['manga'], baseUrl);
            const chapters: MangaChapter[] = parseChapters(payload['chapters']);
            return { details, chapters };
        });
    }

    async chaptersByIds(chapterIds: readonly number[]): Promise<MangaChapter[]> {
        const data = await this.request(QUERIES.chaptersByIds, { ids: chapterIds });
        return this.parsed(() => {
            return parseChapters(record(record(data, 'The answer')['chapters'], 'The chapters')['nodes']);
        });
    }

    async chapterPages(chapterId: number): Promise<string[]> {
        const data = await this.request(QUERIES.chapterPages, { chapterId }, SOURCE_TIMEOUT_MS);
        const baseUrl = await this.deps.baseUrl();
        return this.parsed(() => {
            return parsePageAddresses(record(record(data, 'The answer')['fetchChapterPages'], 'The answer')['pages'], baseUrl);
        });
    }

    private parsed<T>(read: () => T): T {
        try {
            return read();
        } catch (error) {
            if (error instanceof ParseError) {
                throw new SuwayomiApiError('INVALID_RESPONSE', error.message);
            }
            throw error;
        }
    }

    private async request(query: string, variables: Record<string, unknown>, timeoutMs = REQUEST_TIMEOUT_MS): Promise<unknown> {
        for (let attempt = 0; ; attempt += 1) {
            try {
                return await this.requestOnce(query, variables, timeoutMs);
            } catch (error) {
                if (attempt >= CHALLENGE_RETRIES || !(error instanceof SuwayomiApiError) || error.code !== 'API_ERROR' || !REFUSED.test(error.message)) {
                    throw error;
                }
                await new Promise((resolve) => {
                    setTimeout(resolve, this.deps.retryDelayMs ?? CHALLENGE_RETRY_DELAY_MS);
                });
            }
        }
    }

    private async requestOnce(query: string, variables: Record<string, unknown>, timeoutMs: number): Promise<unknown> {
        const operation = `GraphQL ${operationOf(query)}`;
        let baseUrl: string;
        try {
            baseUrl = await this.deps.baseUrl();
        } catch (error) {
            throw new SuwayomiApiError('SERVER_UNAVAILABLE', error instanceof Error ? error.message : String(error), { operation: `Starting the manga server for ${operation}` });
        }
        const url = `${baseUrl}/api/graphql`;
        const known: Partial<ErrorDetails> = { operation, url };
        let response: Response;
        try {
            response = await (this.deps.fetchImpl ?? fetch)(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ query, variables }),
                signal: AbortSignal.timeout(timeoutMs)
            });
        } catch (error) {
            throw new SuwayomiApiError('REQUEST_FAILED', error instanceof Error ? error.message : String(error), { ...describeError(error), ...known });
        }
        if (!response.ok) {
            throw new SuwayomiApiError('REQUEST_FAILED', `The server answered ${response.status}`, { ...known, httpStatus: response.status });
        }
        let answer: GraphqlAnswer;
        try {
            answer = (await response.json()) as GraphqlAnswer;
        } catch {
            throw new SuwayomiApiError('INVALID_RESPONSE', 'The server did not answer with JSON', { ...known, httpStatus: response.status });
        }
        if (Array.isArray(answer.errors) && answer.errors.length > 0) {
            const first = answer.errors[0]?.message;
            throw new SuwayomiApiError('API_ERROR', typeof first === 'string' ? first : 'The server reported an error', { ...known, httpStatus: response.status });
        }
        if (answer.data === undefined || answer.data === null) {
            throw new SuwayomiApiError('INVALID_RESPONSE', 'The server answered without data', { ...known, httpStatus: response.status });
        }
        return answer.data;
    }
}
