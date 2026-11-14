import type { ANIME_SUBTITLE_LANGUAGES, AnimeSubtitleSetting, TranslationLanguage } from './anime';
import type { LanguageCode } from './types';

// A language the subtitles of an anime can be asked of the source in.
export type AnimeSubtitleLanguage = (typeof ANIME_SUBTITLE_LANGUAGES)[number];

// The subtitles asked for when the language of the app has none at the source.
export const SUBTITLE_FALLBACK_LABEL = 'English';

// The name the source gives the subtitles of each language of the app. Chinese and Japanese have none of their own.
export const SUBTITLE_LABEL_OF_LANGUAGE: Record<LanguageCode, AnimeSubtitleLanguage> = {
    en: 'English',
    pt: 'Portuguese',
    es: 'Spanish',
    zh: SUBTITLE_FALLBACK_LABEL,
    ja: SUBTITLE_FALLBACK_LABEL
};

// The language a subtitle is translated into for each language the source offers: the Portuguese of the source is the Brazilian one.
const TRANSLATION_OF_SUBTITLE: Record<AnimeSubtitleLanguage, TranslationLanguage> = {
    English: 'English',
    Portuguese: 'Portuguese (Brazil)',
    Spanish: 'Spanish',
    French: 'French',
    German: 'German',
    Italian: 'Italian',
    Russian: 'Russian'
};

// The language a subtitle is translated into for each language of the app, when the anime subtitles leave the choice to ani-cli.
const TRANSLATION_OF_APP_LANGUAGE: Record<LanguageCode, TranslationLanguage> = {
    en: 'English',
    pt: 'Portuguese (Brazil)',
    es: 'Spanish',
    ja: 'Japanese',
    zh: 'Chinese'
};

// The language the subtitles of the anime are wanted in, so the one they are translated into (D-197): the one of "Anime subtitles" ("auto" is
// the one asked of the source for the language of the app, as ani-cli picks it), or the language of the app when that setting leaves the choice
// to ani-cli ("default").
export function translationTargetOf(setting: AnimeSubtitleSetting, appLanguage: LanguageCode): TranslationLanguage {
    if (setting === 'default') {
        return TRANSLATION_OF_APP_LANGUAGE[appLanguage];
    }
    if (setting === 'auto') {
        return TRANSLATION_OF_SUBTITLE[SUBTITLE_LABEL_OF_LANGUAGE[appLanguage]];
    }
    return TRANSLATION_OF_SUBTITLE[setting];
}
