// @vitest-environment jsdom
import { renderHook, waitFor } from '@testing-library/react';
import { DEFAULT_SETTINGS } from '@shared/constants';
import { CATALOGS } from '@shared/i18n';
import { en } from '@shared/i18n/en';

// Each test takes fresh modules: the setup of the tests loads every language into the modules the other tests share.
async function freshCatalogs() {
    vi.resetModules();
    return import('@renderer/i18n/catalogs');
}

afterEach(() => {
    vi.doUnmock('@shared/i18n/pt');
    vi.resetModules();
});

describe('catalogs of the window', () => {
    it('has only English before any language is loaded, and gives it for the others', async () => {
        const catalogs = await freshCatalogs();
        expect(catalogs.useCatalogStore.getState().catalogs).toEqual({ en });
        expect(catalogs.isCatalogLoaded('en')).toBe(true);
        expect(catalogs.isCatalogLoaded('pt')).toBe(false);
        expect(catalogs.catalogOf('pt')).toEqual(en);
        expect(catalogs.createTranslator('pt')('downloads.nav.history')).toBe('HISTORY');
    });

    it('loads a language and gives its texts after that, the translators made before included', async () => {
        const catalogs = await freshCatalogs();
        const t = catalogs.createTranslator('pt');
        await catalogs.loadCatalog('pt');
        expect(catalogs.isCatalogLoaded('pt')).toBe(true);
        expect(catalogs.catalogOf('pt')).toEqual(CATALOGS.pt);
        expect(t('downloads.nav.history')).toBe('HISTÓRICO');
        expect(t('update.available', { version: '1.2.3' })).toBe('A versão 1.2.3 está disponível.');
        expect(catalogs.isCatalogLoaded('ja')).toBe(false);
    });

    it('gives the same wait to every ask while a language loads, and keeps one copy of it', async () => {
        const catalogs = await freshCatalogs();
        const first = catalogs.loadCatalog('ja');
        const second = catalogs.loadCatalog('ja');
        expect(second).toBe(first);
        await first;
        const loaded = catalogs.catalogOf('ja');
        await catalogs.loadCatalog('ja');
        expect(catalogs.catalogOf('ja')).toBe(loaded);
    });

    it('has nothing to load for English', async () => {
        const catalogs = await freshCatalogs();
        const before = catalogs.useCatalogStore.getState();
        await catalogs.loadCatalog('en');
        expect(catalogs.useCatalogStore.getState()).toBe(before);
    });

    it('loads every language at once', async () => {
        const catalogs = await freshCatalogs();
        await catalogs.loadAllCatalogs();
        expect(catalogs.useCatalogStore.getState().catalogs).toEqual(CATALOGS);
    });

    it('stays in English when a language cannot be loaded, and tries again on the next ask', async () => {
        vi.doMock('@shared/i18n/pt', () => {
            throw new Error('missing chunk');
        });
        const catalogs = await freshCatalogs();
        await expect(catalogs.loadCatalog('pt')).resolves.toBeUndefined();
        expect(catalogs.isCatalogLoaded('pt')).toBe(false);
        expect(catalogs.catalogOf('pt')).toEqual(en);
        vi.doUnmock('@shared/i18n/pt');
        await catalogs.loadCatalog('pt');
        expect(catalogs.catalogOf('pt')).toEqual(CATALOGS.pt);
    });
});

describe('loadStartCatalogs', () => {
    it('loads the language of the device and the one saved in the settings before the first drawing', async () => {
        vi.spyOn(window.navigator, 'language', 'get').mockReturnValue('es-ES');
        const catalogs = await freshCatalogs();
        const readSettings = vi.fn(() => {
            return Promise.resolve({ ...DEFAULT_SETTINGS, language: 'ja' as const });
        });
        await catalogs.loadStartCatalogs(readSettings);
        expect(readSettings).toHaveBeenCalledTimes(1);
        expect(Object.keys(catalogs.useCatalogStore.getState().catalogs).sort()).toEqual(['en', 'es', 'ja']);
        expect(catalogs.catalogOf('ja')).toEqual(CATALOGS.ja);
        expect(catalogs.catalogOf('es')).toEqual(CATALOGS.es);
        vi.restoreAllMocks();
    });

    it('loads only the language of the device when the saved setting is the device', async () => {
        vi.spyOn(window.navigator, 'language', 'get').mockReturnValue('pt-BR');
        const catalogs = await freshCatalogs();
        await catalogs.loadStartCatalogs(() => {
            return Promise.resolve({ ...DEFAULT_SETTINGS, language: 'device' as const });
        });
        expect(Object.keys(catalogs.useCatalogStore.getState().catalogs).sort()).toEqual(['en', 'pt']);
        vi.restoreAllMocks();
    });

    it('loads only the language of the device without a bridge to read the settings', async () => {
        vi.spyOn(window.navigator, 'language', 'get').mockReturnValue('zh-CN');
        const catalogs = await freshCatalogs();
        await catalogs.loadStartCatalogs(null);
        expect(Object.keys(catalogs.useCatalogStore.getState().catalogs).sort()).toEqual(['en', 'zh']);
        vi.restoreAllMocks();
    });

    it('loads the language of the device and does not fail when the settings cannot be read', async () => {
        vi.spyOn(window.navigator, 'language', 'get').mockReturnValue('ja-JP');
        const catalogs = await freshCatalogs();
        await expect(catalogs.loadStartCatalogs(() => {
            return Promise.reject(new Error('no settings'));
        })).resolves.toBeUndefined();
        expect(Object.keys(catalogs.useCatalogStore.getState().catalogs).sort()).toEqual(['en', 'ja']);
        vi.restoreAllMocks();
    });
});

describe('useTranslator and useLanguageCatalog', () => {
    it('show English until the language is loaded, then its texts', async () => {
        vi.resetModules();
        const { useAppStore } = await import('@renderer/store/appStore');
        const { useLanguageCatalog, useTranslator } = await import('@renderer/i18n/useTranslator');
        useAppStore.setState({ settings: { ...DEFAULT_SETTINGS, language: 'ja' } });
        const { result } = renderHook(() => {
            useLanguageCatalog();
            return useTranslator();
        });
        expect(result.current('tab.settings')).toBe('SETTINGS (GLOBAL)');
        await waitFor(() => {
            expect(result.current('tab.settings')).toBe('設定（全体）');
        });
    });

    it('keeps the same translator while neither the language nor its texts change', async () => {
        vi.resetModules();
        const { useTranslator } = await import('@renderer/i18n/useTranslator');
        const { result, rerender } = renderHook(() => {
            return useTranslator();
        });
        const first = result.current;
        rerender();
        expect(result.current).toBe(first);
    });

    it('switches to a new language saved in the settings only once its texts are loaded', async () => {
        vi.resetModules();
        const { installMockApi } = await import('../../helpers/mockApi');
        const mock = installMockApi();
        mock.api.saveSettings.mockResolvedValue({ ...DEFAULT_SETTINGS, language: 'pt' });
        const { useAppStore } = await import('@renderer/store/appStore');
        const catalogs = await import('@renderer/i18n/catalogs');
        expect(catalogs.isCatalogLoaded('pt')).toBe(false);
        const saving = useAppStore.getState().saveSettings({ ...DEFAULT_SETTINGS, language: 'pt' });
        await saving;
        expect(catalogs.isCatalogLoaded('pt')).toBe(true);
        expect(useAppStore.getState().settings.language).toBe('pt');
        expect(catalogs.createTranslator('pt')('downloads.nav.history')).toBe('HISTÓRICO');
    });
});
