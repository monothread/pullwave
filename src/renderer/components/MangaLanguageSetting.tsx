import { useTranslator } from '../i18n/useTranslator';
import { useAppStore } from '../store/appStore';
import { useMangaStore } from '../store/mangaStore';
import { SelectField } from './fields';
import { sourceLanguages } from './mangaSearchSources';
import { ALL_LANGUAGES, listedSources } from './mangaText';
import { sourceLanguageLabel } from './MangaSources';

// The choices: follow the computer (empty), every language, and the languages of the sources that are loaded. The one that is saved is
// always there, even when its sources are not loaded now.
export function mangaLanguageOptions(saved: string, loadedLanguages: readonly string[]): string[] {
    const languages = [...loadedLanguages];
    if (saved !== '' && saved !== ALL_LANGUAGES && !languages.includes(saved)) {
        languages.push(saved);
    }
    return ['', ALL_LANGUAGES, ...languages];
}

interface MangaLanguageSettingProps {
    value: string;
    onChange: (value: string) => void;
}

// The language of the manga section: the sources it lists and searches, the extensions it lists and the sources a manga can move to.
export function MangaLanguageSetting({ value, onChange }: MangaLanguageSettingProps) {
    const t = useTranslator();
    const sources = useMangaStore((state) => {
        return state.browse.sources;
    });
    const showAdult = useAppStore((state) => {
        return state.settings.mangaShowAdult;
    });
    return (
        <SelectField
            label={t('settings.mangaLanguage')}
            value={value}
            options={mangaLanguageOptions(value, sourceLanguages(listedSources(sources, showAdult)))}
            formatOption={(option) => {
                if (option === '') {
                    return t('settings.mangaLanguage.auto');
                }
                return option === ALL_LANGUAGES ? t('manga.sources.allLanguages') : sourceLanguageLabel(option, t);
            }}
            hint={t('settings.mangaLanguage.hint')}
            onChange={onChange}
        />
    );
}
