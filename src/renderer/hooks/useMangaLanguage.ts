import { resolveMangaLanguage } from '../components/mangaText';
import { systemLocale } from '../i18n/language';
import { useAppStore } from '../store/appStore';

// The language the manga section works in (see `resolveMangaLanguage`), given the languages that the thing being listed has.
export function useMangaLanguage(available: readonly string[]): string {
    const setting = useAppStore((state) => {
        return state.settings.mangaLanguage;
    });
    return resolveMangaLanguage(setting, available, systemLocale());
}
