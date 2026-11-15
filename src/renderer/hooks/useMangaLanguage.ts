import { resolveMangaLanguage } from '../components/mangaText';
import { systemLocale } from '../i18n/language';
import { useAppStore } from '../store/appStore';

export function useMangaLanguage(available: readonly string[]): string {
    const setting = useAppStore((state) => {
        return state.settings.mangaLanguage;
    });
    return resolveMangaLanguage(setting, available, systemLocale());
}
