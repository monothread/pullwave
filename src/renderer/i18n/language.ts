import { resolveLanguage } from '@shared/i18n/core';
import type { LanguageCode, LanguageSetting } from '@shared/types';

export function systemLocale(): string {
    return typeof navigator === 'undefined' ? '' : navigator.language;
}

export function resolveAppLanguage(setting: LanguageSetting): LanguageCode {
    return resolveLanguage(setting, systemLocale());
}
