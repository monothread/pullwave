import {
    MAX_CHAPTERS_PER_REQUEST,
    MAX_GENRES,
    MAX_IDS,
    MAX_PREFERENCE_CHOICES,
    MAX_PREFERENCE_TEXT,
    MAX_TEXT,
    asDownloadRequest,
    asExtensionAction,
    asId,
    asIds,
    asListRequest,
    asPackageName,
    asPreferenceChange,
    asReadRequest,
    asSourceId,
    asStoreUrl
} from '@main/services/manga/mangaRequests';

const MANGA = { remoteId: 7, sourceId: '123', title: ' One Piece ', thumbnailUrl: '/api/v1/manga/7/thumbnail' };
const CHAPTER = { remoteId: 11, name: ' Romance Dawn ', number: 1, dateUploaded: 1700000000000, scanlator: 'G', sourceOrder: 3 };

describe('asId and asIds', () => {
    it.each([[1], [42], [Number.MAX_SAFE_INTEGER]])('accepts %j', (value) => {
        expect(asId(value)).toBe(value);
    });

    it.each([[0], [-1], [1.5], ['1'], [null], [undefined], [Number.MAX_SAFE_INTEGER + 1], [NaN]])('refuses %j', (value) => {
        expect(asId(value)).toBeNull();
    });

    it('keeps the ids that are ids, once each', () => {
        expect(asIds([1, 2, 2, 'x', 0, 3, null])).toEqual([1, 2, 3]);
    });

    it('is empty for what is not a list and cuts a list that is too long', () => {
        expect(asIds('x')).toEqual([]);
        expect(asIds(undefined)).toEqual([]);
        expect(asIds(Array.from({ length: MAX_IDS + 10 }, (_value, index) => {
            return index + 1;
        }))).toHaveLength(MAX_IDS);
    });
});

describe('asExtensionAction, asPackageName, asSourceId', () => {
    it('accepts the three actions only', () => {
        expect(asExtensionAction('install')).toBe('install');
        expect(asExtensionAction('uninstall')).toBe('uninstall');
        expect(asExtensionAction('update')).toBe('update');
        expect(asExtensionAction('delete')).toBeNull();
        expect(asExtensionAction(1)).toBeNull();
    });

    it('accepts a package name of letters, digits, dots, dashes and underscores', () => {
        expect(asPackageName('eu.kanade.tachiyomi.extension.en.mangadex')).toBe('eu.kanade.tachiyomi.extension.en.mangadex');
        expect(asPackageName('a-b_c.1')).toBe('a-b_c.1');
    });

    it.each([[''], ['.hidden'], ['a b'], ['a/b'], ['../x'], ['a;b'], ['x'.repeat(202)], [5], [null]])('refuses the package name %j', (value) => {
        expect(asPackageName(value)).toBeNull();
    });

    it('accepts the id of a source (a whole number, maybe negative, kept as text)', () => {
        expect(asSourceId('0')).toBe('0');
        expect(asSourceId('2499283573021220255')).toBe('2499283573021220255');
        expect(asSourceId('-5')).toBe('-5');
    });

    it.each([[''], ['abc'], ['1.5'], [12], ['1'.repeat(21)], [null]])('refuses the source id %j', (value) => {
        expect(asSourceId(value)).toBeNull();
    });
});

describe('asStoreUrl', () => {
    it('accepts http and https addresses', () => {
        expect(asStoreUrl(' https://raw.githubusercontent.com/keiyoushi/extensions/repo/index.min.json ')).toBe('https://raw.githubusercontent.com/keiyoushi/extensions/repo/index.min.json');
        expect(asStoreUrl('http://localhost:8000/index.json')).toBe('http://localhost:8000/index.json');
    });

    it.each([['ftp://a/b'], ['javascript:alert(1)'], ['file:///etc/passwd'], ['not a url'], [''], [5], [null]])('refuses %j', (value) => {
        expect(asStoreUrl(value)).toBeNull();
    });
});

describe('asListRequest', () => {
    it('reads a request for the popular, latest or search list', () => {
        expect(asListRequest({ sourceId: '123', kind: 'popular', page: 1, query: '' })).toEqual({ sourceId: '123', kind: 'popular', page: 1, query: '' });
        expect(asListRequest({ sourceId: '123', kind: 'search', page: 2, query: '  naruto ' })).toEqual({ sourceId: '123', kind: 'search', page: 2, query: 'naruto' });
    });

    it('treats a query that is not text as empty and cuts a long one', () => {
        expect(asListRequest({ sourceId: '1', kind: 'latest', page: 1, query: 5 })?.query).toBe('');
        expect(asListRequest({ sourceId: '1', kind: 'search', page: 1, query: 'x'.repeat(MAX_TEXT + 9) })?.query).toHaveLength(MAX_TEXT);
    });

    it.each([
        [null],
        ['x'],
        [{ kind: 'popular', page: 1 }],
        [{ sourceId: 'abc', kind: 'popular', page: 1 }],
        [{ sourceId: '1', kind: 'other', page: 1 }],
        [{ sourceId: '1', kind: 'popular', page: 0 }],
        [{ sourceId: '1', kind: 'popular', page: '1' }]
    ])('refuses %j', (value) => {
        expect(asListRequest(value)).toBeNull();
    });
});

describe('asReadRequest', () => {
    it('reads the chapter on the server, with or without the one of the library', () => {
        expect(asReadRequest({ chapterRemoteId: 11, libraryChapterId: 4 })).toEqual({ chapterRemoteId: 11, libraryChapterId: 4 });
        expect(asReadRequest({ chapterRemoteId: 11, libraryChapterId: null })).toEqual({ chapterRemoteId: 11, libraryChapterId: null });
        expect(asReadRequest({ chapterRemoteId: 11 })).toEqual({ chapterRemoteId: 11, libraryChapterId: null });
    });

    it.each([[null], ['x'], [{}], [{ chapterRemoteId: 0 }], [{ chapterRemoteId: '1' }], [{ chapterRemoteId: 1, libraryChapterId: 0 }], [{ chapterRemoteId: 1, libraryChapterId: 'a' }]])('refuses %j', (value) => {
        expect(asReadRequest(value)).toBeNull();
    });
});

describe('asListRequest filters', () => {
    const BASE = { sourceId: '1', kind: 'search', page: 1, query: '' };

    it('reads the filters of a search, whatever their options (those are the server\'s)', () => {
        const filters = [
            { type: 'header', name: 'H' },
            { type: 'separator', name: '' },
            { type: 'text', name: 'T', value: 'x' },
            { type: 'checkbox', name: 'C', value: true },
            { type: 'tristate', name: 'S', value: 'exclude' },
            { type: 'select', name: 'Sel', options: ['evil'], value: 2 },
            { type: 'sort', name: 'Sort', options: ['evil'], value: { index: 1, ascending: false } },
            { type: 'group', name: 'G', filters: [{ type: 'checkbox', name: 'C2', value: false }] }
        ];
        expect(asListRequest({ ...BASE, filters })?.filters).toEqual([
            { type: 'header', name: 'H' },
            { type: 'separator', name: '' },
            { type: 'text', name: 'T', value: 'x' },
            { type: 'checkbox', name: 'C', value: true },
            { type: 'tristate', name: 'S', value: 'exclude' },
            { type: 'select', name: 'Sel', options: [], value: 2 },
            { type: 'sort', name: 'Sort', options: [], value: { index: 1, ascending: false } },
            { type: 'group', name: 'G', filters: [{ type: 'checkbox', name: 'C2', value: false }] }
        ]);
    });

    it('takes a group with thousands of filters, as the artists of a site', () => {
        const artists = Array.from({ length: 2400 }, (_unused, index) => {
            return { type: 'tristate', name: `Artist ${String(index)}`, value: 'ignore' };
        });
        expect(asListRequest({ ...BASE, filters: [{ type: 'group', name: 'Artists', filters: artists }] })?.filters).toEqual([{ type: 'group', name: 'Artists', filters: artists }]);
    });

    it('has no filters when none came', () => {
        expect(asListRequest(BASE)).toEqual({ sourceId: '1', kind: 'search', page: 1, query: '' });
    });

    it('cuts a group inside a group inside a group', () => {
        const deep = { type: 'group', name: 'A', filters: [{ type: 'group', name: 'B', filters: [{ type: 'group', name: 'C', filters: [{ type: 'checkbox', name: 'D', value: true }] }] }] };
        expect(asListRequest({ ...BASE, filters: [deep] })?.filters).toEqual([{ type: 'group', name: 'A', filters: [{ type: 'group', name: 'B', filters: [] }] }]);
    });

    it.each([
        ['not a list', 'x'],
        ['an entry that is not an object', [5]],
        ['a kind it does not know', [{ type: 'slider', name: 'x' }]],
        ['a name that is not text', [{ type: 'header', name: 5 }]],
        ['a text value that is not text', [{ type: 'text', name: 'x', value: 5 }]],
        ['a text value that is too long', [{ type: 'text', name: 'x', value: 'y'.repeat(MAX_TEXT + 1) }]],
        ['a checkbox that is not a boolean', [{ type: 'checkbox', name: 'x', value: 'yes' }]],
        ['a state it does not know', [{ type: 'tristate', name: 'x', value: 'maybe' }]],
        ['a select that is not a whole number', [{ type: 'select', name: 'x', value: 1.5 }]],
        ['a select that is negative', [{ type: 'select', name: 'x', value: -1 }]],
        ['a sort without a direction', [{ type: 'sort', name: 'x', value: { index: 0 } }]],
        ['a sort that is not an object', [{ type: 'sort', name: 'x', value: 3 }]],
        ['a group with a bad filter', [{ type: 'group', name: 'x', filters: [{ type: 'slider', name: 'y' }] }]],
        ['too many', Array.from({ length: 5001 }, () => {
            return { type: 'header', name: 'x' };
        })]
    ])('refuses the request with %s', (_label, filters) => {
        expect(asListRequest({ ...BASE, filters })).toBeNull();
    });
});

describe('asDownloadRequest', () => {
    it('reads the manga and its chapters', () => {
        expect(asDownloadRequest({ manga: MANGA, details: null, chapters: [CHAPTER] })).toEqual({
            manga: { remoteId: 7, sourceId: '123', title: 'One Piece', thumbnailUrl: '/api/v1/manga/7/thumbnail' },
            details: null,
            chapters: [{ remoteId: 11, name: 'Romance Dawn', number: 1, dateUploaded: 1700000000000, scanlator: 'G', sourceOrder: 3 }]
        });
    });

    it('reads the details when they are given', () => {
        const request = asDownloadRequest({
            manga: MANGA,
            details: { author: ' Oda ', artist: '', description: 'Pirates', genres: ['Action', '', 5, 'Adventure'], status: 'ongoing', extra: 1 },
            chapters: [CHAPTER]
        });
        expect(request?.details).toEqual({
            remoteId: 7,
            sourceId: '123',
            title: 'One Piece',
            thumbnailUrl: '/api/v1/manga/7/thumbnail',
            author: 'Oda',
            artist: null,
            description: 'Pirates',
            genres: ['Action', 'Adventure'],
            status: 'ongoing'
        });
    });

    it('defaults an unknown status and cuts the genres', () => {
        const request = asDownloadRequest({
            manga: MANGA,
            details: { genres: new Array<string>(MAX_GENRES + 5).fill('g'), status: 'weird' },
            chapters: [CHAPTER]
        });
        expect(request?.details?.status).toBe('unknown');
        expect(request?.details?.genres).toHaveLength(MAX_GENRES);
        expect(asDownloadRequest({ manga: MANGA, details: 'x', chapters: [CHAPTER] })?.details).toBeNull();
    });

    it('fills what a chapter lacks and drops chapters that are not chapters', () => {
        const request = asDownloadRequest({
            manga: MANGA,
            chapters: [{ remoteId: 5 }, { remoteId: 0 }, 'x', { remoteId: 6, number: Infinity, dateUploaded: -4, sourceOrder: 1.5 }, null]
        });
        expect(request?.chapters).toEqual([
            { remoteId: 5, name: '', number: null, dateUploaded: null, scanlator: null, sourceOrder: 0 },
            { remoteId: 6, name: '', number: null, dateUploaded: null, scanlator: null, sourceOrder: 0 }
        ]);
    });

    it('cuts a list that is too long', () => {
        const chapters = Array.from({ length: MAX_CHAPTERS_PER_REQUEST + 5 }, (_value, index) => {
            return { remoteId: index + 1 };
        });
        expect(asDownloadRequest({ manga: MANGA, chapters })?.chapters).toHaveLength(MAX_CHAPTERS_PER_REQUEST);
    });

    it.each([
        [null],
        ['x'],
        [{ chapters: [CHAPTER] }],
        [{ manga: MANGA }],
        [{ manga: MANGA, chapters: 'x' }],
        [{ manga: MANGA, chapters: [] }],
        [{ manga: MANGA, chapters: [{ remoteId: 0 }] }],
        [{ manga: { ...MANGA, remoteId: 0 }, chapters: [CHAPTER] }],
        [{ manga: { ...MANGA, sourceId: 'abc' }, chapters: [CHAPTER] }],
        [{ manga: { ...MANGA, title: '  ' }, chapters: [CHAPTER] }]
    ])('refuses %j', (value) => {
        expect(asDownloadRequest(value)).toBeNull();
    });
});

describe('asPreferenceChange', () => {
    it.each([
        ['text', 'http://x:4567'],
        ['text', ''],
        ['list', 'BASIC'],
        ['switch', true],
        ['checkbox', false],
        ['multiselect', ['en', 'pt']],
        ['multiselect', []]
    ] as const)('accepts a %s setting with the value %j', (type, value) => {
        expect(asPreferenceChange({ sourceId: '123', position: 2, type, value })).toEqual({ sourceId: '123', position: 2, type, value });
    });

    it('accepts the first place in the list', () => {
        expect(asPreferenceChange({ sourceId: '1', position: 0, type: 'switch', value: true })?.position).toBe(0);
    });

    it.each([
        ['text', 5],
        ['text', true],
        ['text', ['a']],
        ['list', null],
        ['switch', 'true'],
        ['switch', 1],
        ['checkbox', 'yes'],
        ['multiselect', 'en'],
        ['multiselect', ['en', 5]],
        ['text', 'x'.repeat(MAX_PREFERENCE_TEXT + 1)]
    ] as const)('refuses a %s setting with the value %j', (type, value) => {
        expect(asPreferenceChange({ sourceId: '1', position: 0, type, value })).toBeNull();
    });

    it('refuses a list of choices that is too long, or one with a text that is too long', () => {
        expect(asPreferenceChange({ sourceId: '1', position: 0, type: 'multiselect', value: new Array<string>(MAX_PREFERENCE_CHOICES + 1).fill('a') })).toBeNull();
        expect(asPreferenceChange({ sourceId: '1', position: 0, type: 'multiselect', value: ['x'.repeat(MAX_PREFERENCE_TEXT + 1)] })).toBeNull();
    });

    it.each([
        [null],
        ['x'],
        [{ position: 0, type: 'text', value: 'x' }],
        [{ sourceId: 'abc', position: 0, type: 'text', value: 'x' }],
        [{ sourceId: '1', type: 'text', value: 'x' }],
        [{ sourceId: '1', position: -1, type: 'text', value: 'x' }],
        [{ sourceId: '1', position: 1.5, type: 'text', value: 'x' }],
        [{ sourceId: '1', position: MAX_PREFERENCE_CHOICES + 1, type: 'text', value: 'x' }],
        [{ sourceId: '1', position: '0', type: 'text', value: 'x' }],
        [{ sourceId: '1', position: 0, type: 'slider', value: 'x' }],
        [{ sourceId: '1', position: 0, value: 'x' }]
    ])('refuses %j', (value) => {
        expect(asPreferenceChange(value)).toBeNull();
    });
});
