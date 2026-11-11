import { TRANSLATION_LANGUAGES, type TranslationLanguage } from '@shared/anime';
import { labelIsInLanguage } from '@main/services/subtitleLanguage';
import { sourceLabelOf } from '@main/services/subtitleFiles';

// Labels a subtitle in each language can have: as the source names it, as the patch of ani-cli writes it in the file name (sourceLabelOf), as
// the app names a translation or a subtitle made from the audio, and codes.
const LABELS: Record<TranslationLanguage, readonly string[]> = {
    'Portuguese (Brazil)': ['Portuguese (Brazil)', 'Portuguese - Brazilian Portuguese', 'Brazilian', 'Português (Brasil)', 'Portugu_s (Brasil)', 'pt-BR', 'pt', 'por', 'PORTUGUESE'],
    Portuguese: ['Portuguese', 'Portuguese (Brazil)', 'Português', 'Portugu_s', 'pt-PT', 'pt'],
    Spanish: ['Spanish', 'Spanish - Latin America', 'Español', 'Espa_ol', 'Espanol', 'Castellano', 'Latino', 'Español (España)', 'es', 'es-419', 'es_ES', 'spa', 'spanish'],
    English: ['English', 'English (CC)', 'ENGLISH', 'Inglés', 'Ingl_s', 'en', 'en-US', 'eng'],
    French: ['French', 'Français', 'Fran_ais', 'Francais', 'fr', 'fr-FR', 'fre', 'fra'],
    German: ['German', 'Deutsch', 'de', 'de-DE', 'ger', 'deu'],
    Italian: ['Italian', 'Italiano', 'it', 'it-IT', 'ita'],
    Russian: ['Russian', 'Русский', 'ru', 'ru-RU', 'rus'],
    Japanese: ['Japanese', '日本語', 'ja', 'jp', 'jpn'],
    Chinese: ['Chinese', 'Chinese (Simplified)', 'Mandarin', '中文', '简体中文', '繁體中文', 'zh', 'zh-Hans', 'chs', 'cht'],
    Korean: ['Korean', '한국어', 'ko', 'kor'],
    Arabic: ['Arabic', 'العربية', 'ar', 'ara'],
    Turkish: ['Turkish', 'Türkçe', 'Turkce', 'T_rk_e', 'tr', 'tur'],
    Indonesian: ['Indonesian', 'Bahasa Indonesia', 'id', 'ind']
};

// Labels that say nothing about a language.
const NEUTRAL = ['Default', 'subtitle', 'Signs & Songs', 'Full', 'Forced', '_______', '', '   ', 'CC', 'SDH', 'v2'];

function otherLanguages(language: TranslationLanguage): TranslationLanguage[] {
    const portuguese = (candidate: TranslationLanguage): boolean => {
        return candidate.startsWith('Portuguese');
    };
    return TRANSLATION_LANGUAGES.filter((candidate) => {
        return candidate !== language && !(portuguese(candidate) && portuguese(language));
    });
}

describe('labelIsInLanguage', () => {
    describe.each(TRANSLATION_LANGUAGES)('%s', (language) => {
        it.each(LABELS[language])('finds the language in the label %j', (label) => {
            expect(labelIsInLanguage(label, language)).toBe(true);
        });

        it.each(otherLanguages(language).flatMap((other) => {
            return LABELS[other].filter((label) => {
                // The labels of both kinds of Portuguese are the same language.
                return !(language.startsWith('Portuguese') && label.toLowerCase().includes('portugu'));
            });
        }))('does not find it in the label of another language %j', (label) => {
            expect(labelIsInLanguage(label, language)).toBe(false);
        });

        it.each(NEUTRAL)('does not find it in a label that names no language %j', (label) => {
            expect(labelIsInLanguage(label, language)).toBe(false);
        });
    });

    it('takes both kinds of Portuguese for the same language', () => {
        expect(labelIsInLanguage('Portuguese', 'Portuguese (Brazil)')).toBe(true);
        expect(labelIsInLanguage('Portuguese - Brazilian Portuguese', 'Portuguese')).toBe(true);
    });

    it('finds the names of the source once the patch of ani-cli wrote them in a file name', () => {
        expect(sourceLabelOf('Español')).toBe('Espa_ol');
        expect(labelIsInLanguage(sourceLabelOf('Español'), 'Spanish')).toBe(true);
        expect(labelIsInLanguage(sourceLabelOf('Português - Brasil'), 'Portuguese (Brazil)')).toBe(true);
        expect(labelIsInLanguage(sourceLabelOf('Français'), 'French')).toBe(true);
        expect(labelIsInLanguage(sourceLabelOf('Türkçe'), 'Turkish')).toBe(true);
    });

    it('does not take a name the file name turned into underscores for any language', () => {
        expect(sourceLabelOf('Русский')).toBe('_______');
        TRANSLATION_LANGUAGES.forEach((language) => {
            expect(labelIsInLanguage(sourceLabelOf('Русский'), language)).toBe(false);
            expect(labelIsInLanguage(sourceLabelOf('日本語'), language)).toBe(false);
        });
    });

    it('only takes a code when the label is a code and nothing else', () => {
        expect(labelIsInLanguage('de', 'German')).toBe(true);
        expect(labelIsInLanguage('Español de España', 'German')).toBe(false);
        expect(labelIsInLanguage('Subtitulado por fans', 'Portuguese')).toBe(false);
        expect(labelIsInLanguage('it is fine', 'Italian')).toBe(false);
        expect(labelIsInLanguage('en-US-x', 'English')).toBe(false);
    });

    it('ignores the spaces around the label', () => {
        expect(labelIsInLanguage('  es  ', 'Spanish')).toBe(true);
        expect(labelIsInLanguage('  Spanish ', 'Spanish')).toBe(true);
    });
});
