import { FALLBACK_LANGUAGE, LANGUAGE_CODES, LANGUAGE_SETTINGS } from '@shared/constants';
import { CATALOGS, createTranslator, interpolate, languageFromLocale, LANGUAGE_NAMES, resolveLanguage } from '@shared/i18n';
import * as core from '@shared/i18n/core';
import { en, type MessageKey } from '@shared/i18n/en';
import type { LanguageCode } from '@shared/types';

const ENGLISH_KEYS = Object.keys(en).sort() as MessageKey[];

function placeholdersOf(text: string): string[] {
    return (text.match(/\{\w+\}/g) ?? []).sort();
}

describe('language constants', () => {
    it('supports English, Portuguese, Spanish, Chinese and Japanese', () => {
        expect(LANGUAGE_CODES).toEqual(['en', 'pt', 'es', 'zh', 'ja']);
    });

    it('offers "device" besides every supported language', () => {
        expect(LANGUAGE_SETTINGS).toEqual(['device', 'en', 'pt', 'es', 'zh', 'ja']);
    });

    it('falls back to English', () => {
        expect(FALLBACK_LANGUAGE).toBe('en');
    });

    it('names every language in itself', () => {
        expect(LANGUAGE_NAMES).toEqual({ en: 'English', pt: 'Português', es: 'Español', zh: '中文', ja: '日本語' });
    });
});

describe.each(LANGUAGE_CODES)('catalog "%s"', (language: LanguageCode) => {
    const catalog = CATALOGS[language];

    it('has exactly the keys of the English catalog', () => {
        expect(Object.keys(catalog).sort()).toEqual(ENGLISH_KEYS);
    });

    it('has no empty message', () => {
        ENGLISH_KEYS.forEach((key) => {
            expect(catalog[key].trim().length, `${language}:${key}`).toBeGreaterThan(0);
        });
    });

    it('keeps the placeholders of the English message', () => {
        ENGLISH_KEYS.forEach((key) => {
            expect(placeholdersOf(catalog[key]), `${language}:${key}`).toEqual(placeholdersOf(en[key]));
        });
    });
});

describe('translations', () => {
    it('translates the same key differently in every language', () => {
        const titles = LANGUAGE_CODES.map((language) => {
            return createTranslator(language)('tab.settings');
        });
        expect(titles).toEqual(['SETTINGS (GLOBAL)', 'CONFIGURAÇÕES (GLOBAIS)', 'AJUSTES (GLOBALES)', '设置（全局）', '設定（全体）']);
    });

    it('names the settings of the video downloader and of the anime section in every language', () => {
        const names = (key: 'downloads.nav.settings' | 'anime.nav.settings'): string[] => {
            return LANGUAGE_CODES.map((language) => {
                return createTranslator(language)(key);
            });
        };
        expect(names('downloads.nav.settings')).toEqual(['SETTINGS', 'CONFIGURAÇÕES', 'AJUSTES', '设置', '設定']);
        expect(names('anime.nav.settings')).toEqual(['SETTINGS', 'CONFIGURAÇÕES', 'AJUSTES', '设置', '設定']);
    });
});

describe('interpolate', () => {
    it('returns the template untouched without params', () => {
        expect(interpolate('Version {version}', undefined)).toBe('Version {version}');
    });

    it('replaces every placeholder, numbers included', () => {
        expect(interpolate('{count} of {total} ({count})', { count: 2, total: 'ten' })).toBe('2 of ten (2)');
    });

    it('keeps a placeholder that has no param', () => {
        expect(interpolate('Hello {name}', { other: 'x' })).toBe('Hello {name}');
    });
});

describe('createTranslator', () => {
    it('returns the message of the language', () => {
        expect(createTranslator('en')('downloads.nav.history')).toBe('HISTORY');
        expect(createTranslator('ja')('downloads.nav.history')).toBe('履歴');
    });

    it('interpolates the params', () => {
        expect(createTranslator('en')('update.available', { version: '1.2.3' })).toBe('Version 1.2.3 is available.');
        expect(createTranslator('pt')('update.available', { version: '1.2.3' })).toBe('A versão 1.2.3 está disponível.');
        expect(createTranslator('zh')('queue.label', { count: 4 })).toBe('队列 [4]');
    });
});

describe('translatorFor', () => {
    it('reads the texts from the messages it is given and interpolates the params', () => {
        const t = core.translatorFor(CATALOGS.es);
        expect(t('downloads.nav.history')).toBe('HISTORIAL');
        expect(t('update.available', { version: '2.0.0' })).toBe(CATALOGS.es['update.available'].replace('{version}', '2.0.0'));
    });
});

describe('the core without the catalogs', () => {
    it('gives the same functions and names the index gives', () => {
        expect(core.interpolate).toBe(interpolate);
        expect(core.languageFromLocale).toBe(languageFromLocale);
        expect(core.resolveLanguage).toBe(resolveLanguage);
        expect(core.LANGUAGE_NAMES).toBe(LANGUAGE_NAMES);
    });

    it('has none of the catalogs, so the window can load them one at a time', () => {
        expect(Object.keys(core).sort()).toEqual(['LANGUAGE_NAMES', 'interpolate', 'languageFromLocale', 'resolveLanguage', 'translatorFor']);
    });
});

describe('languageFromLocale', () => {
    it.each([
        ['en-US', 'en'],
        ['pt-BR', 'pt'],
        ['pt_PT', 'pt'],
        ['es-419', 'es'],
        ['zh-CN', 'zh'],
        ['zh-Hant-TW', 'zh'],
        ['ja', 'ja'],
        ['JA-JP', 'ja']
    ])('maps %s to %s', (locale, expected) => {
        expect(languageFromLocale(locale)).toBe(expected);
    });

    it.each(['fr-FR', 'de', '', 'xx-YY'])('falls back to English for "%s"', (locale) => {
        expect(languageFromLocale(locale)).toBe('en');
    });

    it('falls back to English without a locale', () => {
        expect(languageFromLocale(null)).toBe('en');
        expect(languageFromLocale(undefined)).toBe('en');
    });
});

describe('resolveLanguage', () => {
    it('follows the system locale for "device"', () => {
        expect(resolveLanguage('device', 'es-ES')).toBe('es');
        expect(resolveLanguage('device', 'fr-FR')).toBe('en');
    });

    it('ignores the system locale for an explicit language', () => {
        expect(resolveLanguage('ja', 'es-ES')).toBe('ja');
        expect(resolveLanguage('en', 'pt-BR')).toBe('en');
    });
});
