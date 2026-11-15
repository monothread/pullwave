import { create } from 'zustand';
import { LANGUAGE_CODES } from '@shared/constants';
import { en } from '@shared/i18n/en';
import { interpolate, type Messages, type Translator } from '@shared/i18n/core';
import type { LanguageCode, Settings } from '@shared/types';
import { resolveAppLanguage } from './language';

type OtherLanguage = Exclude<LanguageCode, 'en'>;

const LOADERS: Record<OtherLanguage, () => Promise<Messages>> = {
    pt: async () => {
        return (await import('@shared/i18n/pt')).pt;
    },
    es: async () => {
        return (await import('@shared/i18n/es')).es;
    },
    zh: async () => {
        return (await import('@shared/i18n/zh')).zh;
    },
    ja: async () => {
        return (await import('@shared/i18n/ja')).ja;
    }
};

interface CatalogState {
    catalogs: Partial<Record<LanguageCode, Messages>>;
}

export const useCatalogStore = create<CatalogState>(() => {
    return { catalogs: { en } };
});

const loading = new Map<LanguageCode, Promise<void>>();

export function catalogOf(language: LanguageCode): Messages {
    return useCatalogStore.getState().catalogs[language] ?? en;
}

export function isCatalogLoaded(language: LanguageCode): boolean {
    return useCatalogStore.getState().catalogs[language] !== undefined;
}

export function loadCatalog(language: LanguageCode): Promise<void> {
    if (language === 'en' || isCatalogLoaded(language)) {
        return Promise.resolve();
    }
    const current = loading.get(language);
    if (current !== undefined) {
        return current;
    }
    const job = LOADERS[language]()
        .then((messages) => {
            useCatalogStore.setState((state) => {
                return { catalogs: { ...state.catalogs, [language]: messages } };
            });
        })
        .catch(() => {
            return undefined;
        })
        .finally(() => {
            loading.delete(language);
        });
    loading.set(language, job);
    return job;
}

export function loadAllCatalogs(): Promise<void> {
    return Promise.all(LANGUAGE_CODES.map(loadCatalog)).then(() => {
        return undefined;
    });
}

export async function loadStartCatalogs(readSettings: (() => Promise<Settings>) | null): Promise<void> {
    const languages: LanguageCode[] = [resolveAppLanguage('device')];
    if (readSettings !== null) {
        try {
            languages.push(resolveAppLanguage((await readSettings()).language));
        } catch {
            // The app reads the settings again when it starts, and shows their errors then.
        }
    }
    await Promise.all(languages.map(loadCatalog));
}

export function createTranslator(language: LanguageCode): Translator {
    return (key, params) => {
        return interpolate(catalogOf(language)[key], params);
    };
}
