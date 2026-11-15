import { en } from '@shared/i18n/en';
import { translatorFor, type Translator } from '@shared/i18n/core';
import type { LanguageCode } from '@shared/types';
import { useEffect, useMemo } from 'react';
import { useAppStore } from '../store/appStore';
import { loadCatalog, useCatalogStore } from './catalogs';
import { resolveAppLanguage } from './language';

export function useAppLanguage(): LanguageCode {
    const setting = useAppStore((state) => {
        return state.settings.language;
    });
    return resolveAppLanguage(setting);
}

export function useTranslator(): Translator {
    const language = useAppLanguage();
    const messages = useCatalogStore((state) => {
        return state.catalogs[language] ?? en;
    });
    return useMemo(() => {
        return translatorFor(messages);
    }, [messages]);
}

export function useLanguageCatalog(): void {
    const language = useAppLanguage();
    useEffect(() => {
        void loadCatalog(language);
    }, [language]);
}
