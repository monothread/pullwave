// @vitest-environment jsdom
import {
    DEFAULT_OPTION_ID,
    importFailureKey,
    initialSubtitle,
    optionIdOf,
    optionsOf,
    readSubtitleChoice,
    saveSubtitleChoice,
    STREAM_SUBTITLE_ID,
    streamOptionsOf,
    streamTracks
} from '@renderer/components/subtitleChoice';

const OPTIONS = [
    { id: 'default', label: 'English' },
    { id: 'subtitle-Japanese', label: 'Japanese' }
];

beforeEach(() => {
    window.localStorage.clear();
});

afterEach(() => {
    vi.restoreAllMocks();
});

describe('optionIdOf and optionsOf', () => {
    it('gives the default subtitle an id a <track> can have', () => {
        expect(DEFAULT_OPTION_ID).toBe('default');
        expect(optionIdOf({ id: '', label: 'English', kind: 'default' })).toBe('default');
        expect(optionIdOf({ id: 'subtitle-Japanese', label: 'Japanese', kind: 'source' })).toBe('subtitle-Japanese');
    });

    it('turns the tracks into options with their ids and labels', () => {
        expect(
            optionsOf([
                { id: '', label: 'English', kind: 'default' },
                { id: 'import-aula', label: 'aula', kind: 'imported' }
            ])
        ).toEqual([
            { id: 'default', label: 'English' },
            { id: 'import-aula', label: 'aula' }
        ]);
        expect(optionsOf([])).toEqual([]);
    });

    it('keeps the label of a generated subtitle, with and without the language of the app', () => {
        const tracks = [
            { id: '', label: 'English', kind: 'default' as const },
            { id: 'generated-Japanese', label: 'Japanese', kind: 'generated' as const }
        ];
        expect(optionsOf(tracks)).toEqual([
            { id: 'default', label: 'English' },
            { id: 'generated-Japanese', label: 'Japanese' }
        ]);
        expect(optionsOf(tracks, 'pt')).toEqual([
            { id: 'default', label: 'Inglês' },
            { id: 'generated-Japanese', label: 'Japanese' }
        ]);
    });

    it('keeps the label of a translated subtitle, with and without the language of the app', () => {
        const tracks = [
            { id: '', label: 'English', kind: 'default' as const },
            { id: 'translated-Spanish', label: 'Spanish', kind: 'translated' as const }
        ];
        expect(optionsOf(tracks)).toEqual([
            { id: 'default', label: 'English' },
            { id: 'translated-Spanish', label: 'Spanish' }
        ]);
        expect(optionsOf(tracks, 'pt')).toEqual([
            { id: 'default', label: 'Inglês' },
            { id: 'translated-Spanish', label: 'Spanish' }
        ]);
    });

    describe('with the language of the app', () => {
        const TRACKS = [
            { id: '', label: 'English', kind: 'default' as const },
            { id: 'subtitle-Portuguese (- Portuguese(Brazil))', label: 'Portuguese (- Portuguese(Brazil))', kind: 'source' as const },
            { id: 'subtitle-Spanish', label: 'Spanish', kind: 'source' as const },
            { id: 'import-English', label: 'English', kind: 'imported' as const }
        ];

        it('writes the names of the subtitles of the source in it, and keeps the ids', () => {
            expect(optionsOf(TRACKS, 'pt')).toEqual([
                { id: 'default', label: 'Inglês' },
                { id: 'subtitle-Portuguese (- Portuguese(Brazil))', label: 'Português (Brasil)' },
                { id: 'subtitle-Spanish', label: 'Espanhol' },
                { id: 'import-English', label: 'English' }
            ]);
        });

        it('does not touch the name of a subtitle the user loaded, even when it is written like a language', () => {
            expect(optionsOf([{ id: 'import-Spanish', label: 'Spanish', kind: 'imported' }], 'pt')).toEqual([{ id: 'import-Spanish', label: 'Spanish' }]);
        });

        it('keeps the name the placeholder of the player and the default subtitle have when they are not a language', () => {
            expect(
                optionsOf(
                    [
                        { id: '', label: 'Subtitles', kind: 'default' },
                        { id: '', label: 'Default', kind: 'default' }
                    ],
                    'es'
                )
            ).toEqual([
                { id: 'default', label: 'Subtitles' },
                { id: 'default', label: 'Default' }
            ]);
        });

        it('tells two subtitles apart that would be written the same', () => {
            expect(
                optionsOf(
                    [
                        { id: 'subtitle-Portuguese (- Portuguese(Brazil))', label: 'Portuguese (- Portuguese(Brazil))', kind: 'source' },
                        { id: 'subtitle-Portuguese (Brazil)', label: 'Portuguese (Brazil)', kind: 'source' }
                    ],
                    'pt'
                ).map((option) => {
                    return option.label;
                })
            ).toEqual(['Português (Brasil)', 'Portuguese (Brazil)']);
        });
    });
});

describe('importFailureKey', () => {
    it.each([
        ['unsupported', 'anime.player.subtitleError.unsupported'],
        ['too-large', 'anime.player.subtitleError.too-large'],
        ['unreadable', 'anime.player.subtitleError.unreadable'],
        ['missing', 'anime.player.subtitleError.missing']
    ] as const)('gives the message of %s', (reason, key) => {
        expect(importFailureKey(reason)).toBe(key);
    });
});

describe('the choice of an episode', () => {
    it('has none until the viewer chooses', () => {
        expect(readSubtitleChoice(1)).toBeUndefined();
    });

    it('remembers an id and "off" for each episode', () => {
        saveSubtitleChoice(1, 'subtitle-Japanese');
        saveSubtitleChoice(2, null);
        expect(readSubtitleChoice(1)).toBe('subtitle-Japanese');
        expect(readSubtitleChoice(2)).toBeNull();
        expect(readSubtitleChoice(3)).toBeUndefined();
        expect(window.localStorage.getItem('pullwave-subtitle-1')).toBe('subtitle-Japanese');
        expect(window.localStorage.getItem('pullwave-subtitle-2')).toBe('off');
    });

    it('works without storage', () => {
        vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
            throw new Error('blocked');
        });
        vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
            throw new Error('blocked');
        });
        expect(readSubtitleChoice(1)).toBeUndefined();
        expect(() => {
            saveSubtitleChoice(1, 'default');
        }).not.toThrow();
    });
});

describe('initialSubtitle', () => {
    it('keeps what was chosen when it is still there', () => {
        expect(initialSubtitle(OPTIONS, 'subtitle-Japanese')).toBe('subtitle-Japanese');
    });

    it('keeps the subtitles off when they were turned off', () => {
        expect(initialSubtitle(OPTIONS, null)).toBeNull();
    });

    it('takes the first subtitle when nothing was chosen or the choice is gone', () => {
        expect(initialSubtitle(OPTIONS, undefined)).toBe('default');
        expect(initialSubtitle(OPTIONS, 'subtitle-Korean')).toBe('default');
    });

    it('has nothing to show without subtitles', () => {
        expect(initialSubtitle([], undefined)).toBeNull();
        expect(initialSubtitle([], 'default')).toBeNull();
    });
});

describe('streamTracks', () => {
    const base = { sessionId: 's1', url: 'pullwave-stream://p/s1/abc' };
    const ARABIC = { id: 'stream-1', label: 'Arabic', url: 'pullwave-stream://p/s1/ar' };
    const ENGLISH = { id: 'stream-2', label: 'English', url: 'pullwave-stream://p/s1/en' };
    const PORTUGUESE = { id: 'stream-3', label: 'Portuguese (- Portuguese(Brazil))', url: 'pullwave-stream://p/s1/pt' };

    it('has none when the source offers none and ani-cli picked none', () => {
        expect(streamTracks({ ...base, subtitleUrl: null, subtitles: [] })).toEqual([]);
    });

    it('keeps the one ani-cli picked as the only subtitle, with the id the player gives it, when the source does not list them', () => {
        expect(streamTracks({ ...base, subtitleUrl: 'pullwave-stream://p/s1/en', subtitles: [] })).toEqual([{ id: STREAM_SUBTITLE_ID, label: 'Subtitles', url: 'pullwave-stream://p/s1/en' }]);
        expect(STREAM_SUBTITLE_ID).toBe('stream');
    });

    it('puts the one ani-cli picked first and keeps the order of the rest', () => {
        expect(streamTracks({ ...base, subtitleUrl: ENGLISH.url, subtitles: [ARABIC, ENGLISH, PORTUGUESE] })).toEqual([ENGLISH, ARABIC, PORTUGUESE]);
        expect(streamTracks({ ...base, subtitleUrl: PORTUGUESE.url, subtitles: [ARABIC, ENGLISH, PORTUGUESE] })).toEqual([PORTUGUESE, ARABIC, ENGLISH]);
    });

    it('keeps the order of the source when the picked one is already the first', () => {
        expect(streamTracks({ ...base, subtitleUrl: ARABIC.url, subtitles: [ARABIC, ENGLISH, PORTUGUESE] })).toEqual([ARABIC, ENGLISH, PORTUGUESE]);
    });

    it('keeps the order of the source when the picked one is not in the list, or none was picked', () => {
        expect(streamTracks({ ...base, subtitleUrl: 'pullwave-stream://p/s1/other', subtitles: [ARABIC, ENGLISH] })).toEqual([ARABIC, ENGLISH]);
        expect(streamTracks({ ...base, subtitleUrl: null, subtitles: [ARABIC, ENGLISH] })).toEqual([ARABIC, ENGLISH]);
    });

    it('does not change the list it was given', () => {
        const subtitles = [ARABIC, ENGLISH, PORTUGUESE];

        streamTracks({ ...base, subtitleUrl: PORTUGUESE.url, subtitles });

        expect(subtitles).toEqual([ARABIC, ENGLISH, PORTUGUESE]);
    });
});

describe('streamOptionsOf', () => {
    const TRACKS = [
        { id: 'stream-2', label: 'English', url: 'u2' },
        { id: 'stream-1', label: 'Arabic', url: 'u1' },
        { id: 'stream-3', label: 'Portuguese (- Portuguese(Brazil))', url: 'u3' },
        { id: 'stream-4', label: 'Spanish (- Spanish(Latin America))', url: 'u4' }
    ];

    it('names the languages as the language of the app does, keeping the order and the ids', () => {
        expect(streamOptionsOf(TRACKS, 'en')).toEqual([
            { id: 'stream-2', label: 'English' },
            { id: 'stream-1', label: 'Arabic' },
            { id: 'stream-3', label: 'Portuguese (Brazil)' },
            { id: 'stream-4', label: 'Spanish (Latin America)' }
        ]);
        expect(streamOptionsOf(TRACKS, 'pt')).toEqual([
            { id: 'stream-2', label: 'Inglês' },
            { id: 'stream-1', label: 'Árabe' },
            { id: 'stream-3', label: 'Português (Brasil)' },
            { id: 'stream-4', label: 'Espanhol (América Latina)' }
        ]);
    });

    it('keeps the generic name of the only subtitle when the source does not list them', () => {
        expect(streamOptionsOf([{ id: STREAM_SUBTITLE_ID, label: 'Subtitles', url: 'u' }], 'pt')).toEqual([{ id: STREAM_SUBTITLE_ID, label: 'Subtitles' }]);
    });

    it('has no options without tracks', () => {
        expect(streamOptionsOf([], 'en')).toEqual([]);
    });
});
