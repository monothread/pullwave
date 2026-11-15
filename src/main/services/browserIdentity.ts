export interface RegisteredBrowser {
    name: string;
    key: string;
}

const WINDOWS_DATA_FOLDER = 'user data';
const RELEASE_WORDS = new Set(['stable', 'beta', 'dev', 'unstable', 'browser']);

export function normalizeBrowserKey(text: string): string {
    const words = text
        .toLowerCase()
        .split(/[^a-z0-9]+/)
        .filter((word) => {
            return word.length > 0;
        });
    while (words.length > 1 && RELEASE_WORDS.has(words[words.length - 1] ?? '')) {
        words.pop();
    }
    return words.join('');
}

function productFolderOf(dataDir: string): string {
    const parts = dataDir.replace(/\\/g, '/').split('/').filter((part) => {
        return part.length > 0;
    });
    const last = parts[parts.length - 1] ?? '';
    return last.toLowerCase() === WINDOWS_DATA_FOLDER ? (parts[parts.length - 2] ?? '') : last;
}

export function findRegisteredBrowser(dataDir: string, registered: readonly RegisteredBrowser[]): RegisteredBrowser | null {
    const wanted = normalizeBrowserKey(productFolderOf(dataDir));
    if (wanted.length === 0) {
        return null;
    }
    return (
        registered.find((browser) => {
            return normalizeBrowserKey(browser.key) === wanted;
        }) ?? null
    );
}
