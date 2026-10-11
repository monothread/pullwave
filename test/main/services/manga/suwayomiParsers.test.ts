import {
    MAX_CHAPTERS,
    MAX_DESCRIPTION_LENGTH,
    MAX_GENRES,
    MAX_PAGES,
    MAX_TEXT_LENGTH,
    ParseError,
    list,
    parseChapter,
    parseChapters,
    parseDetails,
    parseExtension,
    parseFilters,
    parseListing,
    parsePageAddresses,
    parsePreferences,
    parseSource,
    parseStatus,
    parseStore,
    parseSummary,
    record,
    resolveAddress
} from '@main/services/manga/suwayomiParsers';

const BASE = 'http://127.0.0.1:4321';

describe('record and list', () => {
    it('accept an object and a list', () => {
        expect(record({ a: 1 }, 'x')).toEqual({ a: 1 });
        expect(list([1, 2, 3], 'x', 2)).toEqual([1, 2]);
    });

    it.each([[null], ['x'], [[]], [5]])('refuse %j as an object', (value) => {
        expect(() => {
            return record(value, 'The thing');
        }).toThrow('The thing must be an object');
    });

    it('refuses what is not a list', () => {
        expect(() => {
            return list({}, 'The things', 5);
        }).toThrow('The things must be a list');
    });
});

describe('resolveAddress', () => {
    it('resolves a path of the server against it', () => {
        expect(resolveAddress('/api/v1/manga/3/thumbnail', BASE)).toBe('http://127.0.0.1:4321/api/v1/manga/3/thumbnail');
    });

    it('keeps an http(s) address', () => {
        expect(resolveAddress('https://cdn.example/a.jpg', BASE)).toBe('https://cdn.example/a.jpg');
    });

    it('drops other protocols, empty values and what is not text', () => {
        expect(resolveAddress('javascript:alert(1)', BASE)).toBeNull();
        expect(resolveAddress('file:///etc/passwd', BASE)).toBeNull();
        expect(resolveAddress('data:text/html,x', BASE)).toBeNull();
        expect(resolveAddress('  ', BASE)).toBeNull();
        expect(resolveAddress(5, BASE)).toBeNull();
        expect(resolveAddress(null, BASE)).toBeNull();
    });
});

describe('parseStatus', () => {
    it.each([
        ['ONGOING', 'ongoing'],
        ['COMPLETED', 'completed'],
        ['PUBLISHING_FINISHED', 'completed'],
        ['ON_HIATUS', 'hiatus'],
        ['CANCELLED', 'cancelled'],
        ['LICENSED', 'unknown'],
        ['UNKNOWN', 'unknown'],
        ['whatever', 'unknown'],
        [5, 'unknown']
    ])('maps %j to %s', (value, expected) => {
        expect(parseStatus(value)).toBe(expected);
    });
});

describe('parseStore', () => {
    it('reads the address and the name', () => {
        expect(parseStore({ indexUrl: ' https://a.example/index.json ', name: ' Keiyoushi ' })).toEqual({ indexUrl: 'https://a.example/index.json', name: 'Keiyoushi' });
    });

    it('names a store after its address when it has no name', () => {
        expect(parseStore({ indexUrl: 'https://a.example/i.json', name: '' })).toEqual({ indexUrl: 'https://a.example/i.json', name: 'https://a.example/i.json' });
    });

    it('refuses a store without an address', () => {
        expect(() => {
            return parseStore({ name: 'x' });
        }).toThrow('The address of a store must be a text');
    });
});

describe('parseExtension', () => {
    it('reads every field and resolves the icon', () => {
        expect(
            parseExtension(
                {
                    pkgName: 'eu.kanade.x',
                    name: 'Tachiyomi: X',
                    lang: 'pt',
                    versionName: '1.4.2',
                    isInstalled: true,
                    hasUpdate: true,
                    isObsolete: true,
                    iconUrl: '/api/v1/extension/icon/x',
                    contentWarning: 'NSFW',
                    storeIndexUrl: 'https://a.example/i.json'
                },
                BASE
            )
        ).toEqual({
            pkgName: 'eu.kanade.x',
            name: 'Tachiyomi: X',
            lang: 'pt',
            versionName: '1.4.2',
            isInstalled: true,
            hasUpdate: true,
            isObsolete: true,
            iconUrl: 'http://127.0.0.1:4321/api/v1/extension/icon/x',
            contentWarning: 'NSFW',
            storeIndexUrl: 'https://a.example/i.json'
        });
    });

    it('defaults what is missing or unknown', () => {
        expect(parseExtension({ pkgName: 'p', name: 'N', contentWarning: 'weird', isInstalled: 'yes' }, BASE)).toEqual({
            pkgName: 'p',
            name: 'N',
            lang: 'all',
            versionName: '',
            isInstalled: false,
            hasUpdate: false,
            isObsolete: false,
            iconUrl: null,
            contentWarning: 'SAFE',
            storeIndexUrl: null
        });
    });

    it('refuses an extension without a package or a name', () => {
        expect(() => {
            return parseExtension({ name: 'N' }, BASE);
        }).toThrow('The package of an extension must be a text');
        expect(() => {
            return parseExtension({ pkgName: 'p' }, BASE);
        }).toThrow('The name of an extension must be a text');
    });
});

describe('parseSource', () => {
    it('reads the source with the name it is shown by and its extension', () => {
        expect(
            parseSource({ id: '123', name: 'Site', displayName: 'Site (EN)', lang: 'en', iconUrl: '/i.png', supportsLatest: true, isConfigurable: true, contentWarning: 'MIXED', extension: { pkgName: 'eu.kanade.x' } }, BASE)
        ).toEqual({ id: '123', name: 'Site (EN)', lang: 'en', iconUrl: 'http://127.0.0.1:4321/i.png', supportsLatest: true, isConfigurable: true, contentWarning: 'MIXED', extensionPkg: 'eu.kanade.x' });
    });

    it('falls back to the name and to no extension', () => {
        expect(parseSource({ id: '0', name: 'Local source' }, BASE)).toEqual({
            id: '0',
            name: 'Local source',
            lang: 'all',
            iconUrl: null,
            supportsLatest: false,
            isConfigurable: false,
            contentWarning: 'SAFE',
            extensionPkg: null
        });
    });

    it('refuses a source without an id or a name', () => {
        expect(() => {
            return parseSource({ name: 'x' }, BASE);
        }).toThrow('The id of a source must be a text');
        expect(() => {
            return parseSource({ id: '1' }, BASE);
        }).toThrow('The name of a source must be a text');
    });
});

describe('parseSummary and parseDetails', () => {
    it('reads a manga', () => {
        expect(parseSummary({ id: 7, sourceId: '123', title: ' One Piece ', thumbnailUrl: '/api/v1/manga/7/thumbnail', extra: 1 }, BASE)).toEqual({
            remoteId: 7,
            sourceId: '123',
            title: 'One Piece',
            thumbnailUrl: 'http://127.0.0.1:4321/api/v1/manga/7/thumbnail'
        });
    });

    it('cuts a title that is too long', () => {
        expect(parseSummary({ id: 1, sourceId: '1', title: 'x'.repeat(MAX_TEXT_LENGTH + 20) }, BASE).title).toHaveLength(MAX_TEXT_LENGTH);
    });

    it.each([[{ sourceId: '1', title: 'x' }], [{ id: 1.5, sourceId: '1', title: 'x' }], [{ id: '1', sourceId: '1', title: 'x' }], [{ id: 1, title: 'x' }], [{ id: 1, sourceId: '1', title: '' }], ['x']])(
        'refuses %j',
        (value) => {
            expect(() => {
                return parseSummary(value, BASE);
            }).toThrow(ParseError);
        }
    );

    it('reads the details', () => {
        expect(
            parseDetails({ id: 7, sourceId: '1', title: 'T', thumbnailUrl: null, author: 'A', artist: 'B', description: 'D', genre: ['x', '', 5, 'y'], status: 'ONGOING' }, BASE)
        ).toEqual({ remoteId: 7, sourceId: '1', title: 'T', thumbnailUrl: null, author: 'A', artist: 'B', description: 'D', genres: ['x', 'y'], status: 'ongoing' });
    });

    it('defaults the missing details and cuts the long ones', () => {
        const details = parseDetails({ id: 1, sourceId: '1', title: 'T', description: 'd'.repeat(MAX_DESCRIPTION_LENGTH + 5), genre: new Array<string>(MAX_GENRES + 5).fill('g') }, BASE);
        expect(details.description).toHaveLength(MAX_DESCRIPTION_LENGTH);
        expect(details.genres).toHaveLength(MAX_GENRES);
        expect(details).toMatchObject({ author: null, artist: null, status: 'unknown' });
        expect(parseDetails({ id: 1, sourceId: '1', title: 'T', genre: 'x' }, BASE).genres).toEqual([]);
    });
});

describe('parseListing', () => {
    it('reads the mangas and whether there is another page', () => {
        expect(parseListing([{ id: 1, sourceId: '1', title: 'A' }], true, BASE)).toEqual({
            items: [{ remoteId: 1, sourceId: '1', title: 'A', thumbnailUrl: null }],
            hasNextPage: true
        });
        expect(parseListing([], 'true', BASE).hasNextPage).toBe(false);
    });

    it('refuses what is not a list', () => {
        expect(() => {
            return parseListing({}, false, BASE);
        }).toThrow('The mangas must be a list');
    });
});

describe('parseChapter and parseChapters', () => {
    it('reads a chapter', () => {
        expect(parseChapter({ id: 9, name: ' Ch 1 ', chapterNumber: 1.5, uploadDate: '1700000000000', scanlator: 'G', sourceOrder: 3 })).toEqual({
            remoteId: 9,
            name: 'Ch 1',
            number: 1.5,
            dateUploaded: 1700000000000,
            scanlator: 'G',
            sourceOrder: 3
        });
    });

    it('treats a number below zero (unknown) and a date of zero as not known', () => {
        expect(parseChapter({ id: 9, chapterNumber: -1, uploadDate: '0' })).toEqual({
            remoteId: 9,
            name: '',
            number: null,
            dateUploaded: null,
            scanlator: null,
            sourceOrder: 0
        });
        expect(parseChapter({ id: 9, chapterNumber: 0, uploadDate: 'abc' })).toMatchObject({ number: 0, dateUploaded: null });
    });

    it('refuses a chapter without a whole id', () => {
        expect(() => {
            return parseChapter({ name: 'x' });
        }).toThrow('The id of a chapter must be a whole number');
    });

    it('puts the newest chapter first, whatever the order the server gave', () => {
        expect(
            parseChapters([
                { id: 1, sourceOrder: 1 },
                { id: 3, sourceOrder: 3 },
                { id: 2, sourceOrder: 2 }
            ]).map((chapter) => {
                return chapter.remoteId;
            })
        ).toEqual([3, 2, 1]);
    });

    it('keeps only the first chapters when there are too many', () => {
        const chapters = Array.from({ length: MAX_CHAPTERS + 3 }, (_value, index) => {
            return { id: index };
        });
        expect(parseChapters(chapters)).toHaveLength(MAX_CHAPTERS);
    });
});

describe('parsePageAddresses', () => {
    it('resolves the addresses of the pages against the server', () => {
        expect(parsePageAddresses(['/api/v1/manga/1/chapter/2/page/0', 'https://cdn.example/1.jpg'], BASE)).toEqual([
            'http://127.0.0.1:4321/api/v1/manga/1/chapter/2/page/0',
            'https://cdn.example/1.jpg'
        ]);
    });

    it('refuses a page without a usable address', () => {
        expect(() => {
            return parsePageAddresses(['/ok', 'javascript:x'], BASE);
        }).toThrow('A page has no usable address');
    });

    it('keeps only the first pages when there are too many', () => {
        expect(parsePageAddresses(Array.from({ length: MAX_PAGES + 4 }, () => {
            return '/p';
        }), BASE)).toHaveLength(MAX_PAGES);
    });

    it('refuses what is not a list', () => {
        expect(() => {
            return parsePageAddresses('x', BASE);
        }).toThrow(ParseError);
    });
});

describe('parsePreferences', () => {
    const text = { __typename: 'EditTextPreference', key: 'Server URL Address', title: 'Server URL Address', summary: 'i.e. http://192.168.1.115:4567', visible: true, enabled: true, editValue: 'http://x:4567' };
    const list = { __typename: 'ListPreference', key: 'Login Mode', title: 'Login Mode', summary: 'None', visible: true, enabled: true, listValue: 'NONE', entries: ['None', 'Basic'], entryValues: ['NONE', 'BASIC'] };
    const toggle = { __typename: 'SwitchPreference', key: 'hq', title: 'High quality', summary: '', visible: true, enabled: false, switchValue: true };
    const check = { __typename: 'CheckBoxPreference', key: 'safe', title: 'Safe mode', summary: '', visible: true, enabled: true, checkValue: false };
    const multi = { __typename: 'MultiSelectListPreference', key: 'langs', title: 'Languages', summary: '', visible: true, enabled: true, multiValue: ['en'], entries: ['English', 'Portuguese'], entryValues: ['en', 'pt'] };

    it('reads the five kinds of setting, each with its place in the list', () => {
        expect(parsePreferences([text, list, toggle, check, multi])).toEqual([
            { position: 0, type: 'text', key: 'Server URL Address', title: 'Server URL Address', summary: 'i.e. http://192.168.1.115:4567', enabled: true, value: 'http://x:4567' },
            { position: 1, type: 'list', key: 'Login Mode', title: 'Login Mode', summary: 'None', enabled: true, value: 'NONE', entries: ['None', 'Basic'], entryValues: ['NONE', 'BASIC'] },
            { position: 2, type: 'switch', key: 'hq', title: 'High quality', summary: '', enabled: false, value: true },
            { position: 3, type: 'checkbox', key: 'safe', title: 'Safe mode', summary: '', enabled: true, value: false },
            { position: 4, type: 'multiselect', key: 'langs', title: 'Languages', summary: '', enabled: true, value: ['en'], entries: ['English', 'Portuguese'], entryValues: ['en', 'pt'] }
        ]);
    });

    it('leaves out the hidden settings but keeps the place the others have in the list', () => {
        expect(
            parsePreferences([{ ...text, visible: false }, list]).map((preference) => {
                return [preference.position, preference.key];
            })
        ).toEqual([[1, 'Login Mode']]);
    });

    it('leaves out a kind it does not know', () => {
        expect(
            parsePreferences([{ __typename: 'SliderPreference', key: 'x', visible: true }, check]).map((preference) => {
                return preference.position;
            })
        ).toEqual([1]);
    });

    it('fills what is missing', () => {
        expect(parsePreferences([{ __typename: 'EditTextPreference', key: 'name' }, { __typename: 'ListPreference', key: 'l' }, { __typename: 'MultiSelectListPreference', key: 'm', entries: [1, 'a'], multiValue: 'x' }])).toEqual([
            { position: 0, type: 'text', key: 'name', title: 'name', summary: '', enabled: true, value: '' },
            { position: 1, type: 'list', key: 'l', title: 'l', summary: '', enabled: true, value: '', entries: [], entryValues: [] },
            { position: 2, type: 'multiselect', key: 'm', title: 'm', summary: '', enabled: true, value: [], entries: ['a'], entryValues: [] }
        ]);
    });

    it('refuses a setting without a key, and what is not a list of settings', () => {
        expect(() => {
            return parsePreferences([{ __typename: 'EditTextPreference', title: 'x' }]);
        }).toThrow('The key of a setting must be a text');
        expect(() => {
            return parsePreferences('x');
        }).toThrow('The settings must be a list');
        expect(() => {
            return parsePreferences([5]);
        }).toThrow('A setting must be an object');
    });
});

describe('parseFilters', () => {
    it('reads every kind of filter, keeping its place in the list', () => {
        expect(
            parseFilters([
                { __typename: 'HeaderFilter', name: 'Note' },
                { __typename: 'SeparatorFilter', name: '' },
                { __typename: 'TextFilter', name: 'Author', textValue: 'Oda' },
                { __typename: 'CheckBoxFilter', name: 'Chapters', checkValue: true },
                { __typename: 'TriStateFilter', name: 'Action', triValue: 'EXCLUDE' },
                { __typename: 'SelectFilter', name: 'Within', values: ['a', 'b'], selectValue: 1 },
                { __typename: 'SortFilter', name: 'Sort', sortOptions: ['Name', 'Date'], sortValue: { index: 1, ascending: true } },
                { __typename: 'GroupFilter', name: 'Genre', filters: [{ __typename: 'TriStateFilter', name: 'Drama', triValue: 'INCLUDE' }] }
            ])
        ).toEqual([
            { type: 'header', name: 'Note' },
            { type: 'separator', name: '' },
            { type: 'text', name: 'Author', value: 'Oda' },
            { type: 'checkbox', name: 'Chapters', value: true },
            { type: 'tristate', name: 'Action', value: 'exclude' },
            { type: 'select', name: 'Within', options: ['a', 'b'], value: 1 },
            { type: 'sort', name: 'Sort', options: ['Name', 'Date'], value: { index: 1, ascending: true } },
            { type: 'group', name: 'Genre', filters: [{ type: 'tristate', name: 'Drama', value: 'include' }] }
        ]);
    });

    it('keeps the place of a kind it does not know, as a separator', () => {
        expect(parseFilters([{ __typename: 'SliderFilter', name: 'x' }, { __typename: 'CheckBoxFilter', name: 'y', checkValue: false }])).toEqual([
            { type: 'separator', name: 'x' },
            { type: 'checkbox', name: 'y', value: false }
        ]);
    });

    it('falls back to the first option and to not used when a value is missing or out of range', () => {
        expect(
            parseFilters([
                { __typename: 'TextFilter', name: 'T' },
                { __typename: 'TriStateFilter', name: 'S', triValue: 'WHATEVER' },
                { __typename: 'SelectFilter', name: 'Sel', values: ['a'], selectValue: 9 },
                { __typename: 'SortFilter', name: 'Sort', sortOptions: ['a'], sortValue: { index: 4, ascending: false } },
                { __typename: 'SortFilter', name: 'Sort2', sortOptions: ['a'] }
            ])
        ).toEqual([
            { type: 'text', name: 'T', value: '' },
            { type: 'tristate', name: 'S', value: 'ignore' },
            { type: 'select', name: 'Sel', options: ['a'], value: 0 },
            { type: 'sort', name: 'Sort', options: ['a'], value: { index: 0, ascending: false } },
            { type: 'sort', name: 'Sort2', options: ['a'], value: { index: 0, ascending: false } }
        ]);
    });

    it('does not go deeper than a group inside a group', () => {
        const deep = { __typename: 'GroupFilter', name: 'A', filters: [{ __typename: 'GroupFilter', name: 'B', filters: [{ __typename: 'GroupFilter', name: 'C', filters: [{ __typename: 'TextFilter', name: 'D' }] }] }] };
        expect(parseFilters([deep])).toEqual([{ type: 'group', name: 'A', filters: [{ type: 'group', name: 'B', filters: [] }] }]);
    });

    it('cuts a long name', () => {
        expect(parseFilters([{ __typename: 'HeaderFilter', name: 'n'.repeat(MAX_TEXT_LENGTH + 5) }])).toEqual([{ type: 'header', name: 'n'.repeat(MAX_TEXT_LENGTH) }]);
    });

    it('refuses what is not a list of objects', () => {
        expect(() => {
            return parseFilters('x');
        }).toThrow(ParseError);
        expect(() => {
            return parseFilters([5]);
        }).toThrow(ParseError);
    });
});
