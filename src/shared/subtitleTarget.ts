import type { ANIME_SUBTITLE_LANGUAGES, AnimeSubtitleSetting, TranslationLanguage } from './anime';
import type { LanguageCode } from './types';

export type AnimeSubtitleLanguage = (typeof ANIME_SUBTITLE_LANGUAGES)[number];

export const SUBTITLE_FALLBACK_LABEL = 'English';

export const SUBTITLE_LABEL_OF_LANGUAGE: Record<LanguageCode, AnimeSubtitleLanguage> = {
    en: 'English',
    pt: 'Portuguese',
    es: 'Spanish',
    zh: SUBTITLE_FALLBACK_LABEL,
    ja: SUBTITLE_FALLBACK_LABEL
};

const TRANSLATION_OF_SUBTITLE: Record<AnimeSubtitleLanguage, TranslationLanguage> = {
    English: 'English',
    Portuguese: 'Portuguese (Brazil)',
    Spanish: 'Spanish',
    French: 'French',
    German: 'German',
    Italian: 'Italian',
    Russian: 'Russian'
};

const TRANSLATION_OF_APP_LANGUAGE: Record<LanguageCode, TranslationLanguage> = {
    en: 'English',
    pt: 'Portuguese (Brazil)',
    es: 'Spanish',
    ja: 'Japanese',
    zh: 'Chinese'
};

export function translationTargetOf(setting: AnimeSubtitleSetting, appLanguage: LanguageCode): TranslationLanguage {
    if (setting === 'default') {
        return TRANSLATION_OF_APP_LANGUAGE[appLanguage];
    }
    if (setting === 'auto') {
        return TRANSLATION_OF_SUBTITLE[SUBTITLE_LABEL_OF_LANGUAGE[appLanguage]];
    }
    return TRANSLATION_OF_SUBTITLE[setting];
}
