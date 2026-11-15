import type { TranslationLanguage } from '@shared/anime';
import { translationTargetOf } from '@shared/subtitleTarget';
import { useAppLanguage } from '../i18n/useTranslator';
import { useAppStore } from '../store/appStore';

export function useTranslationTarget(): TranslationLanguage {
    const animeSubtitles = useAppStore((state) => {
        return state.settings.animeSubtitles;
    });
    return translationTargetOf(animeSubtitles, useAppLanguage());
}
