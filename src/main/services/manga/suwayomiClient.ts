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
// Asking a site for its chapters can take a while.
export const SOURCE_TIMEOUT_MS = 180_000;

export class SuwayomiApiError extends Error {
    constructor(
        readonly code: MangaErrorCode,
        message: string
    ) {
        super(message);
    }
}

export interface SuwayomiClientDependencies {
    // The address of the server, starting it if it does not run.
    baseUrl: () => Promise<string>;
    fetchImpl?: typeof fetch;
}

const EXTENSION_FIELDS = 'pkgName name lang versionName isInstalled hasUpdate isObsolete iconUrl contentWarning storeIndexUrl extensionLib';
const SOURCE_FIELDS = 'id name displayName lang iconUrl supportsLatest isConfigurable contentWarning extension { pkgName storeIndexUrl }';
const MANGA_FIELDS = 'id sourceId title thumbnailUrl';
const MANGA_DETAIL_FIELDS = `${MANGA_FIELDS} realUrl author artist description genre status`;
// The kinds of setting have fields of the same name with different types: each is asked for under a name of its own.
const PREFERENCE_FIELDS = `__typename
    ... on EditTextPreference { key title summary visible enabled editValue: currentValue }
    ... on ListPreference { key title summary visible enabled listValue: currentValue entries entryValues }
    ... on SwitchPreference { key title summary visible enabled switchValue: currentValue }
    ... on CheckBoxPreference { key title summary visible enabled checkValue: currentValue }
    ... on MultiSelectListPreference { key title summary visible enabled multiValue: currentValue entries entryValues }`;
// One level of groups is asked for (a group holds filters of the other kinds).
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
    setFlareSolverr: `mutation ($settings: PartialSettingsTypeInput!) { setSettings(input: { settings: $settings }) { settings { flareSolverrEnabled flareSolverrUrl } } }`,
    chapterPages: 'mutation ($chapterId: Int!) { fetchChapterPages(input: { chapterId: $chapterId }) { pages } }'
} as const;

// The change as the server wants it: the value goes in the field of its kind.
function preferenceChange(change: MangaPreferenceChange): Record<string, unknown> {
    const FIELDS = { text: 'editTextState', list: 'listState', switch: 'switchState', checkbox: 'checkBoxState', multiselect: 'multiSelectState' } as const;
    return { position: change.position, [FIELDS[change.type]]: change.value };
}

// The filters as the server wants them: each one that has a value, named by its place in its list (a group carries its own).
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

// Talks to the server in its own language. Every method throws a SuwayomiApiError the caller turns into an answer.
export class SuwayomiClient {
    constructor(private readonly deps: SuwayomiClientDependencies) {}

    // Points the server at a FlareSolverr (or turns the bypass off when there is none), on a server that is running already: a server
    // started before the helper was ready would otherwise keep answering that the bypass is disabled.
    async setFlareSolverr(address: string | null): Promise<void> {
        await this.request(QUERIES.setFlareSolverr, { settings: address === null ? { flareSolverrEnabled: false } : { flareSolverrEnabled: true, flareSolverrUrl: address, flareSolverrAsResponseFallback: true } });
    }

    // Asks the server who it is: it answers, and with which version (the server is started if it does not run).
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

    // Asks the stores for their lists again, then gives what they offer.
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

    // Updates the extensions given (the ones that have no update are left as they are).
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

    // Changes one setting of a source and gives the settings as they are now.
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

    // The addresses (on the server) of the pages of a chapter, in reading order.
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
        let baseUrl: string;
        try {
            baseUrl = await this.deps.baseUrl();
        } catch (error) {
            throw new SuwayomiApiError('SERVER_UNAVAILABLE', error instanceof Error ? error.message : String(error));
        }
        let response: Response;
        try {
            response = await (this.deps.fetchImpl ?? fetch)(`${baseUrl}/api/graphql`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ query, variables }),
                signal: AbortSignal.timeout(timeoutMs)
            });
        } catch (error) {
            throw new SuwayomiApiError('REQUEST_FAILED', error instanceof Error ? error.message : String(error));
        }
        if (!response.ok) {
            throw new SuwayomiApiError('REQUEST_FAILED', `The server answered ${response.status}`);
        }
        let answer: GraphqlAnswer;
        try {
            answer = (await response.json()) as GraphqlAnswer;
        } catch {
            throw new SuwayomiApiError('INVALID_RESPONSE', 'The server did not answer with JSON');
        }
        if (Array.isArray(answer.errors) && answer.errors.length > 0) {
            const first = answer.errors[0]?.message;
            throw new SuwayomiApiError('API_ERROR', typeof first === 'string' ? first : 'The server reported an error');
        }
        if (answer.data === undefined || answer.data === null) {
            throw new SuwayomiApiError('INVALID_RESPONSE', 'The server answered without data');
        }
        return answer.data;
    }
}
