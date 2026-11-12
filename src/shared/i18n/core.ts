import { FALLBACK_LANGUAGE, LANGUAGE_CODES } from '../constants';
import type { LanguageCode, LanguageSetting } from '../types';
import type { MessageKey, Messages } from './en';

// What every side of the app needs to translate, without the catalogs of the languages: the window loads only the one it shows
// (see src/renderer/i18n/catalogs.ts), the main process takes them all from index.ts.

export type { MessageKey, Messages };
export type MessageParams = Record<string, string | number>;
export type Translator = (key: MessageKey, params?: MessageParams) => string;

// Each language is named in itself so it can be found even when the interface is in a language the user cannot read.
export const LANGUAGE_NAMES: Record<LanguageCode, string> = {
    en: 'English',
    pt: 'Português',
    es: 'Español',
    zh: '中文',
    ja: '日本語'
};

function isLanguageCode(value: string): value is LanguageCode {
    return LANGUAGE_CODES.some((code) => {
        return code === value;
    });
}

// "pt-BR" and "zh_CN" are matched by their primary subtag; anything unsupported falls back to English.
export function languageFromLocale(locale: string | null | undefined): LanguageCode {
    const primary = (locale ?? '').toLowerCase().split(/[-_]/)[0] ?? '';
    return isLanguageCode(primary) ? primary : FALLBACK_LANGUAGE;
}

export function resolveLanguage(setting: LanguageSetting, systemLocale: string | null | undefined): LanguageCode {
    return setting === 'device' ? languageFromLocale(systemLocale) : setting;
}

export function interpolate(template: string, params: MessageParams | undefined): string {
    if (params === undefined) {
        return template;
    }
    return template.replace(/\{(\w+)\}/g, (placeholder, name: string) => {
        const value = params[name];
        return value === undefined ? placeholder : String(value);
    });
}

// A translator that reads its texts from the messages it is given.
export function translatorFor(messages: Messages): Translator {
    return (key, params) => {
        return interpolate(messages[key], params);
    };
}
