import { FALLBACK_LANGUAGE, LANGUAGE_CODES } from '../constants';
import type { LanguageCode, LanguageSetting } from '../types';
import type { MessageKey, Messages } from './en';

export type { MessageKey, Messages };
export type MessageParams = Record<string, string | number>;
export type Translator = (key: MessageKey, params?: MessageParams) => string;

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

export function translatorFor(messages: Messages): Translator {
    return (key, params) => {
        return interpolate(messages[key], params);
    };
}
