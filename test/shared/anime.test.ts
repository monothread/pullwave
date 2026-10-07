import { animeMediaUrl, ANIME_MEDIA_SCHEME, ANIME_STREAM_SCHEME, DEFAULT_TRANSCRIPTION_LANGUAGE, DEFAULT_TRANSLATION_LANGUAGE, generatePlanOf, isAnimeSupported, isSpokenLanguage, SPEECH_PART_SECONDS, TRANSCRIPTION_LANGUAGE_CODES, TRANSCRIPTION_LANGUAGES, TRANSLATION_LANGUAGES } from '@shared/anime';

describe('isAnimeSupported', () => {
    it.each(['linux', 'win32'])('is true on %s', (platform) => {
        expect(isAnimeSupported(platform)).toBe(true);
    });

    it.each(['darwin', 'freebsd', 'android', 'sunos', ''])('is false on %j', (platform) => {
        expect(isAnimeSupported(platform)).toBe(false);
    });
});

describe('animeMediaUrl', () => {
    it('names the schemes the player reads through', () => {
        expect(ANIME_MEDIA_SCHEME).toBe('pullwave-media');
        expect(ANIME_STREAM_SCHEME).toBe('pullwave-stream');
    });

    it('builds the address of the video and of the subtitles of an episode', () => {
        expect(animeMediaUrl('episode', 12)).toBe('pullwave-media://episode/12');
        expect(animeMediaUrl('subtitle', 7)).toBe('pullwave-media://subtitle/7');
    });
});

describe('TRANSLATION_LANGUAGES', () => {
    it('lists the languages a subtitle can be translated into', () => {
        expect(TRANSLATION_LANGUAGES).toEqual([
            'Portuguese (Brazil)',
            'Portuguese',
            'Spanish',
            'English',
            'French',
            'German',
            'Italian',
            'Russian',
            'Japanese',
            'Chinese',
            'Korean',
            'Arabic',
            'Turkish',
            'Indonesian'
        ]);
    });

    it('has no language twice', () => {
        expect(new Set(TRANSLATION_LANGUAGES).size).toBe(TRANSLATION_LANGUAGES.length);
    });

    it('translates into Brazilian Portuguese by default, which is one of the languages', () => {
        expect(DEFAULT_TRANSLATION_LANGUAGE).toBe('Portuguese (Brazil)');
        expect(TRANSLATION_LANGUAGES).toContain(DEFAULT_TRANSLATION_LANGUAGE);
    });
});

describe('TRANSCRIPTION_LANGUAGES', () => {
    it('lists the languages the audio of an episode can be in', () => {
        expect(TRANSCRIPTION_LANGUAGES).toEqual(['Japanese', 'English', 'Chinese', 'Korean', 'Spanish', 'Portuguese', 'French', 'German', 'Italian', 'Russian', 'Arabic', 'Turkish', 'Indonesian']);
    });

    it('has the two letters the service of speech to text is told for each one, and none twice', () => {
        expect(TRANSCRIPTION_LANGUAGE_CODES).toEqual({
            Japanese: 'ja',
            English: 'en',
            Chinese: 'zh',
            Korean: 'ko',
            Spanish: 'es',
            Portuguese: 'pt',
            French: 'fr',
            German: 'de',
            Italian: 'it',
            Russian: 'ru',
            Arabic: 'ar',
            Turkish: 'tr',
            Indonesian: 'id'
        });
        expect(Object.keys(TRANSCRIPTION_LANGUAGE_CODES)).toEqual([...TRANSCRIPTION_LANGUAGES]);
        expect(new Set(Object.values(TRANSCRIPTION_LANGUAGE_CODES)).size).toBe(TRANSCRIPTION_LANGUAGES.length);
    });

    it('is Japanese by default, which is one of the languages', () => {
        expect(DEFAULT_TRANSCRIPTION_LANGUAGE).toBe('Japanese');
        expect(TRANSCRIPTION_LANGUAGES).toContain(DEFAULT_TRANSCRIPTION_LANGUAGE);
    });

    it('cuts the audio in parts of ten minutes', () => {
        expect(SPEECH_PART_SECONDS).toBe(600);
    });
});

describe('isSpokenLanguage', () => {
    it.each([
        ['Japanese', 'Japanese'],
        ['English', 'English'],
        ['Portuguese', 'Portuguese'],
        ['Portuguese', 'Portuguese (Brazil)']
    ] as const)('says audio in %s is spoken in %s', (audio, language) => {
        expect(isSpokenLanguage(audio, language)).toBe(true);
    });

    it.each([
        ['Japanese', 'English'],
        ['English', 'Japanese'],
        ['Spanish', 'Portuguese (Brazil)'],
        ['Portuguese', 'Spanish']
    ] as const)('says audio in %s is not spoken in %s', (audio, language) => {
        expect(isSpokenLanguage(audio, language)).toBe(false);
    });
});

describe('generatePlanOf', () => {
    it.each([
        ['Japanese', 'Japanese'],
        ['English', 'English'],
        ['Portuguese', 'Portuguese (Brazil)']
    ] as const)('only transcribes audio in %s for a subtitle in %s', (audio, language) => {
        expect(generatePlanOf(audio, language)).toBe('transcribe');
    });

    it.each(['Japanese', 'Korean', 'Spanish', 'Portuguese'] as const)('translates audio in %s into English at once', (audio) => {
        expect(generatePlanOf(audio, 'English')).toBe('direct');
    });

    it.each([
        ['Japanese', 'Portuguese (Brazil)'],
        ['English', 'Spanish'],
        ['Chinese', 'Japanese'],
        ['Spanish', 'Portuguese']
    ] as const)('transcribes audio in %s and translates the text for a subtitle in %s', (audio, language) => {
        expect(generatePlanOf(audio, language)).toBe('transcribe-translate');
    });
});

describe('generatePlanOf for a service that writes the audio in any language at once', () => {
    it.each([
        ['Japanese', 'Portuguese (Brazil)'],
        ['English', 'Spanish'],
        ['Chinese', 'Japanese'],
        ['Spanish', 'Portuguese'],
        ['Japanese', 'English']
    ] as const)('writes audio in %s as a subtitle in %s at once', (audio, language) => {
        expect(generatePlanOf(audio, language, 'any')).toBe('direct');
    });

    it.each([
        ['Japanese', 'Japanese'],
        ['English', 'English'],
        ['Portuguese', 'Portuguese (Brazil)']
    ] as const)('still only transcribes audio in %s for a subtitle in %s', (audio, language) => {
        expect(generatePlanOf(audio, language, 'any')).toBe('transcribe');
    });

    it('is the plan of a service that only writes English at once when the way is not given', () => {
        expect(generatePlanOf('Japanese', 'Spanish')).toBe('transcribe-translate');
        expect(generatePlanOf('Japanese', 'Spanish', 'english')).toBe('transcribe-translate');
        expect(generatePlanOf('Japanese', 'English', 'english')).toBe('direct');
    });
});
