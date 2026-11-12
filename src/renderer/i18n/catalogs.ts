import { create } from 'zustand';
import { LANGUAGE_CODES } from '@shared/constants';
import { en } from '@shared/i18n/en';
import { interpolate, type Messages, type Translator } from '@shared/i18n/core';
import type { LanguageCode, Settings } from '@shared/types';
import { resolveAppLanguage } from './language';

// The texts of the window in each language. English is always there (it is what is shown while another language is loading); the others are separate files, loaded the first time they are shown, so the window does not read
// the four languages it does not show each time the app opens.

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

// The texts of the language, or the English ones while it is not loaded.
export function catalogOf(language: LanguageCode): Messages {
    return useCatalogStore.getState().catalogs[language] ?? en;
}

export function isCatalogLoaded(language: LanguageCode): boolean {
    return useCatalogStore.getState().catalogs[language] !== undefined;
}

// Loads the texts of the language (once: asking again while it loads gives the same wait). When they cannot be loaded the window stays
// in English, and the next ask tries again.
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

// Loads, before the first drawing, the texts of the language of the device (shown until the settings arrive) and of the language saved in
// the settings, so the window never shows up in another language first. Without the settings (no bridge, or they cannot be read) only the
// language of the device is loaded.
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

// A translator that reads the texts of the language when it is called: once the language is loaded it gives its texts.
export function createTranslator(language: LanguageCode): Translator {
    return (key, params) => {
        return interpolate(catalogOf(language)[key], params);
    };
}
