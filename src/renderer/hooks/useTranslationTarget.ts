import type { TranslationLanguage } from '@shared/anime';
import { translationTargetOf } from '@shared/subtitleTarget';
import { useAppLanguage } from '../i18n/useTranslator';
import { useAppStore } from '../store/appStore';

// The language subtitles are translated into: the one of the anime subtitles of the settings, or the language of the app when they leave the
// choice to ani-cli (D-197). The windows that translate or make a subtitle start on it.
export function useTranslationTarget(): TranslationLanguage {
    const animeSubtitles = useAppStore((state) => {
        return state.settings.animeSubtitles;
    });
    return translationTargetOf(animeSubtitles, useAppLanguage());
}
