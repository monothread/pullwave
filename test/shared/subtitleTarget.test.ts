import { ANIME_SUBTITLE_LANGUAGES, ANIME_SUBTITLE_SETTINGS, TRANSLATION_LANGUAGES } from '@shared/anime';
import { SUBTITLE_FALLBACK_LABEL, SUBTITLE_LABEL_OF_LANGUAGE, translationTargetOf } from '@shared/subtitleTarget';
import type { LanguageCode } from '@shared/types';

const APP_LANGUAGES: LanguageCode[] = ['en', 'pt', 'es', 'ja', 'zh'];

describe('the subtitles the source is asked for in each language of the app', () => {
    it('asks for the language of the app, and for English when the source has none in it (Chinese and Japanese)', () => {
        expect(SUBTITLE_FALLBACK_LABEL).toBe('English');
        expect(SUBTITLE_LABEL_OF_LANGUAGE).toEqual({ en: 'English', pt: 'Portuguese', es: 'Spanish', zh: 'English', ja: 'English' });
    });

    it('asks only for languages the anime subtitles offer', () => {
        Object.values(SUBTITLE_LABEL_OF_LANGUAGE).forEach((label) => {
            expect(ANIME_SUBTITLE_LANGUAGES).toContain(label);
        });
    });
});

describe('translationTargetOf', () => {
    it.each([
        ['English', 'English'],
        ['Portuguese', 'Portuguese (Brazil)'],
        ['Spanish', 'Spanish'],
        ['French', 'French'],
        ['German', 'German'],
        ['Italian', 'Italian'],
        ['Russian', 'Russian']
    ] as const)('translates into the language chosen for the anime subtitles (%s → %s), whatever the language of the app', (setting, expected) => {
        APP_LANGUAGES.forEach((language) => {
            expect(translationTargetOf(setting, language)).toBe(expected);
        });
    });

    it.each([
        ['en', 'English'],
        ['pt', 'Portuguese (Brazil)'],
        ['es', 'Spanish'],
        ['zh', 'English'],
        ['ja', 'English']
    ] as const)('translates into the subtitles asked for the language of the app (%s → %s) when the anime subtitles follow it', (language, expected) => {
        expect(translationTargetOf('auto', language)).toBe(expected);
    });

    it.each([
        ['en', 'English'],
        ['pt', 'Portuguese (Brazil)'],
        ['es', 'Spanish'],
        ['ja', 'Japanese'],
        ['zh', 'Chinese']
    ] as const)('translates into the language of the app (%s → %s) when the anime subtitles are what ani-cli picks', (language, expected) => {
        expect(translationTargetOf('default', language)).toBe(expected);
    });

    it('always gives a language subtitles can be translated into, for every setting and every language of the app', () => {
        ANIME_SUBTITLE_SETTINGS.forEach((setting) => {
            APP_LANGUAGES.forEach((language) => {
                expect(TRANSLATION_LANGUAGES).toContain(translationTargetOf(setting, language));
            });
        });
    });

    it('never translates into the Portuguese of Portugal: the Portuguese of the source is the Brazilian one', () => {
        ANIME_SUBTITLE_SETTINGS.forEach((setting) => {
            APP_LANGUAGES.forEach((language) => {
                expect(translationTargetOf(setting, language)).not.toBe('Portuguese');
            });
        });
    });
});
