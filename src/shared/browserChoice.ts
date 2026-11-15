import type { Translator } from './i18n';
import type { DetectedBrowser, Settings } from './types';

export const NO_BROWSER_CHOSEN = '';

export function findChosenBrowser(browsers: readonly DetectedBrowser[], settings: Pick<Settings, 'cookiesBrowserDir'>): DetectedBrowser | null {
    if (settings.cookiesBrowserDir.length === 0) {
        return null;
    }
    return (
        browsers.find((browser) => {
            return browser.dataDir === settings.cookiesBrowserDir;
        }) ?? null
    );
}

export function chosenBrowserWarning(browsers: readonly DetectedBrowser[] | null, settings: Pick<Settings, 'useBrowserCookies' | 'cookiesBrowser' | 'cookiesBrowserDir'>,
    t: Translator
): string | null {
    if (browsers === null || !settings.useBrowserCookies) {
        return null;
    }
    if (browsers.length === 0) {
        return t('browser.noneFound');
    }
    if (findChosenBrowser(browsers, settings) !== null) {
        return null;
    }
    return t('browser.savedNotFound', { browser: settings.cookiesBrowser });
}
