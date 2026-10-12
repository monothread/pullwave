import { browserLaunches, launchProgram, openSiteIn, type SiteOpenerDependencies } from '@main/services/siteOpener';

const URL_OF_MANGA = 'https://dex.example/manga/one-piece?a=1&b=2';

function setup(overrides: Partial<SiteOpenerDependencies> & { present?: string[]; launches?: boolean[] } = {}) {
    const launched: Array<{ command: string; args: string[] }> = [];
    const opened: string[] = [];
    const answers = [...(overrides.launches ?? [])];
    const deps: SiteOpenerDependencies = {
        platform: 'linux',
        env: {},
        exists: (path) => {
            return (overrides.present ?? []).includes(path);
        },
        launch: (command, args) => {
            launched.push({ command, args });
            return Promise.resolve(answers.length > 0 ? answers.shift()! : true);
        },
        openDefault: (url) => {
            opened.push(url);
        },
        ...overrides
    };
    return { deps, launched, opened };
}

describe('browserLaunches on Linux', () => {
    it.each([
        ['chrome', ['google-chrome-stable', 'google-chrome']],
        ['firefox', ['firefox']],
        ['brave', ['brave-browser', 'brave']],
        ['chromium', ['chromium', 'chromium-browser']],
        ['edge', ['microsoft-edge-stable', 'microsoft-edge']],
        ['opera', ['opera']],
        ['vivaldi', ['vivaldi-stable', 'vivaldi']]
    ] as const)('lists the programs of %s, each with the address as its only argument', (browser, commands) => {
        const { deps } = setup();
        expect(browserLaunches(browser, URL_OF_MANGA, deps)).toEqual(
            commands.map((command) => {
                return { command, args: [URL_OF_MANGA] };
            })
        );
    });
});

describe('browserLaunches on macOS', () => {
    it('opens the application by its name, with the address as an argument', () => {
        const { deps } = setup({ platform: 'darwin' });
        expect(browserLaunches('chrome', URL_OF_MANGA, deps)).toEqual([{ command: 'open', args: ['-a', 'Google Chrome', URL_OF_MANGA] }]);
        expect(browserLaunches('brave', URL_OF_MANGA, deps)).toEqual([{ command: 'open', args: ['-a', 'Brave Browser', URL_OF_MANGA] }]);
    });
});

describe('browserLaunches on Windows', () => {
    const ENV = { ProgramFiles: 'C:\\Program Files', 'ProgramFiles(x86)': 'C:\\Program Files (x86)', LOCALAPPDATA: 'C:\\Users\\a\\AppData\\Local' };

    it('gives the program that is installed, with the address as its only argument and no shell in between', () => {
        const chrome = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
        const { deps } = setup({ platform: 'win32', env: ENV, present: [chrome] });
        const launches = browserLaunches('chrome', URL_OF_MANGA, deps);
        expect(launches).toEqual([{ command: chrome, args: [URL_OF_MANGA] }]);
    });

    it('gives none when the browser is not where it is usually installed', () => {
        const { deps } = setup({ platform: 'win32', env: ENV });
        expect(browserLaunches('firefox', URL_OF_MANGA, deps)).toEqual([]);
    });

    it('skips the folders the system does not say', () => {
        const { deps } = setup({ platform: 'win32', env: { LOCALAPPDATA: '' }, exists: () => {
            return true;
        } });
        expect(browserLaunches('chrome', URL_OF_MANGA, deps)).toEqual([]);
    });

    it('tries every place a browser can be in', () => {
        const checked: string[] = [];
        const { deps } = setup({ platform: 'win32', env: ENV, exists: (path) => {
            checked.push(path);
            return false;
        } });
        browserLaunches('chrome', URL_OF_MANGA, deps);
        expect(checked).toHaveLength(3);
    });
});

describe('openSiteIn', () => {
    it('opens it with the browser of the system when that is the choice, without starting any program', async () => {
        const { deps, launched, opened } = setup();
        await openSiteIn(URL_OF_MANGA, 'default', deps);
        expect(opened).toEqual([URL_OF_MANGA]);
        expect(launched).toEqual([]);
    });

    it('opens it in the browser chosen, and not with the one of the system, when it starts', async () => {
        const { deps, launched, opened } = setup();
        await openSiteIn(URL_OF_MANGA, 'firefox', deps);
        expect(launched).toEqual([{ command: 'firefox', args: [URL_OF_MANGA] }]);
        expect(opened).toEqual([]);
    });

    it('tries the next program of the browser when one is not there', async () => {
        const { deps, launched, opened } = setup({ launches: [false, true] });
        await openSiteIn(URL_OF_MANGA, 'chrome', deps);
        expect(launched).toEqual([
            { command: 'google-chrome-stable', args: [URL_OF_MANGA] },
            { command: 'google-chrome', args: [URL_OF_MANGA] }
        ]);
        expect(opened).toEqual([]);
    });

    it('opens it with the browser of the system when the browser chosen is not found or does not start', async () => {
        const { deps, launched, opened } = setup({ launches: [false, false] });
        await openSiteIn(URL_OF_MANGA, 'chrome', deps);
        expect(launched).toHaveLength(2);
        expect(opened).toEqual([URL_OF_MANGA]);
    });

    it('opens it with the browser of the system on Windows when the browser chosen is not installed', async () => {
        const { deps, launched, opened } = setup({ platform: 'win32', env: { ProgramFiles: 'C:\\Program Files' } });
        await openSiteIn(URL_OF_MANGA, 'vivaldi', deps);
        expect(launched).toEqual([]);
        expect(opened).toEqual([URL_OF_MANGA]);
    });
});

describe('launchProgram', () => {
    it('says a program started', async () => {
        await expect(launchProgram(process.execPath, ['-e', ''])).resolves.toBe(true);
    });

    it('says a program that is not there did not', async () => {
        await expect(launchProgram('pullwave-no-such-browser', ['https://dex.example'])).resolves.toBe(false);
    });
});
