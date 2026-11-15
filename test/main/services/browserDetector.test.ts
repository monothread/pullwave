import { detectBrowsers, type DetectionEnvironment, type FileProbe } from '@main/services/browserDetector';
import type { RegisteredBrowser } from '@main/services/browserIdentity';

interface DiskOptions {
    separator?: string;
    contents?: Record<string, string>;
}

function fakeDisk(files: string[], { separator = '/', contents = {} }: DiskOptions = {}): FileProbe {
    const fileSet = new Set(files);
    const directories = new Map<string, Set<string>>();
    const filesByDirectory = new Map<string, Set<string>>();
    files.forEach((file) => {
        const parts = file.split(separator);
        for (let index = 1; index < parts.length - 1; index += 1) {
            const parent = parts.slice(0, index).join(separator) || separator;
            directories.set(parent, (directories.get(parent) ?? new Set<string>()).add(parts[index] ?? ''));
        }
        const folder = parts.slice(0, -1).join(separator) || separator;
        filesByDirectory.set(folder, (filesByDirectory.get(folder) ?? new Set<string>()).add(parts[parts.length - 1] ?? ''));
    });
    return {
        listDirectories: async (dir) => {
            return [...(directories.get(dir) ?? [])];
        },
        listFiles: async (dir) => {
            return [...(filesByDirectory.get(dir) ?? [])];
        },
        exists: async (path) => {
            return fileSet.has(path) || directories.has(path);
        },
        readText: async (path) => {
            return contents[path] ?? null;
        }
    };
}

interface ChromiumLayout {
    profiles?: string[];
    firstRun?: boolean;
    cookiesFile?: string;
}

function chromiumFiles(dir: string, { profiles = ['Default'], firstRun = true, cookiesFile = 'Cookies' }: ChromiumLayout = {}, separator = '/'): string[] {
    return [
        `${dir}${separator}Local State`,
        ...(firstRun ? [`${dir}${separator}First Run`] : []),
        ...profiles.map((profile) => {
            return `${dir}${separator}${profile}${separator}${cookiesFile.split('/').join(separator)}`;
        })
    ];
}

const HOME = '/home/lucas';
const LINUX: DetectionEnvironment = { platform: 'linux', homeDir: HOME, env: {} };
const ORIGIN_DIR = `${HOME}/.config/BraveSoftware/Brave-Origin`;
const FIREFOX_DIR = `${HOME}/.config/mozilla/firefox`;

describe('detectBrowsers on Linux', () => {
    it('finds Brave Origin with its own folder, the brave engine and the name of its profile', async () => {
        const probe = fakeDisk(chromiumFiles(ORIGIN_DIR), {
            contents: { [`${ORIGIN_DIR}/Local State`]: JSON.stringify({ profile: { info_cache: { Default: { name: 'Personal' } } } }) }
        });
        await expect(detectBrowsers(LINUX, probe)).resolves.toEqual([
            { label: 'Brave Origin', engine: 'brave', dataDir: ORIGIN_DIR, profiles: [{ id: 'Default', name: 'Personal' }] }
        ]);
    });

    it('finds several browsers, picks the engine of each and sorts them by label', async () => {
        const probe = fakeDisk([
            ...chromiumFiles(`${HOME}/.config/chromium`),
            ...chromiumFiles(`${HOME}/.config/google-chrome`, { cookiesFile: 'Network/Cookies' }),
            ...chromiumFiles(`${HOME}/.config/microsoft-edge`, { profiles: ['Profile 1'], cookiesFile: 'Network/Cookies' }),
            ...chromiumFiles(`${HOME}/.config/vivaldi`),
            ...chromiumFiles(`${HOME}/.config/opera`)
        ]);
        await expect(detectBrowsers(LINUX, probe)).resolves.toEqual([
            { label: 'Chromium', engine: 'chromium', dataDir: `${HOME}/.config/chromium`, profiles: [{ id: 'Default', name: 'Default' }] },
            { label: 'Google Chrome', engine: 'chrome', dataDir: `${HOME}/.config/google-chrome`, profiles: [{ id: 'Default', name: 'Default' }] },
            { label: 'Microsoft Edge', engine: 'edge', dataDir: `${HOME}/.config/microsoft-edge`, profiles: [{ id: 'Profile 1', name: 'Profile 1' }] },
            { label: 'Opera', engine: 'opera', dataDir: `${HOME}/.config/opera`, profiles: [{ id: 'Default', name: 'Default' }] },
            { label: 'Vivaldi', engine: 'vivaldi', dataDir: `${HOME}/.config/vivaldi`, profiles: [{ id: 'Default', name: 'Default' }] }
        ]);
    });

    it('uses the chromium engine for a browser it does not know', async () => {
        const probe = fakeDisk(chromiumFiles(`${HOME}/.config/my-new_browser`));
        await expect(detectBrowsers(LINUX, probe)).resolves.toEqual([
            { label: 'My New Browser', engine: 'chromium', dataDir: `${HOME}/.config/my-new_browser`, profiles: [{ id: 'Default', name: 'Default' }] }
        ]);
    });

    it('lists only the profiles that have cookies, the default one first and the others in numeric order', async () => {
        const dir = `${HOME}/.config/chromium`;
        const probe = fakeDisk(
            [
                ...chromiumFiles(dir, { profiles: ['Profile 10', 'Profile 2', 'Default'] }),
                `${dir}/Profile 3/Preferences`,
                `${dir}/Guest Profile/Cookies`
            ],
            { contents: { [`${dir}/Local State`]: JSON.stringify({ profile: { info_cache: { 'Profile 2': { name: 'Work' }, Default: { name: '' } } } }) } }
        );
        const [browser] = await detectBrowsers(LINUX, probe);
        expect(browser?.profiles).toEqual([
            { id: 'Default', name: 'Default' },
            { id: 'Profile 2', name: 'Work' },
            { id: 'Profile 10', name: 'Profile 10' }
        ]);
    });

    it('falls back to the folder name when Local State cannot be read', async () => {
        const dir = `${HOME}/.config/chromium`;
        const probe = fakeDisk(chromiumFiles(dir), { contents: { [`${dir}/Local State`]: '{ not json' } });
        const [browser] = await detectBrowsers(LINUX, probe);
        expect(browser?.profiles).toEqual([{ id: 'Default', name: 'Default' }]);
    });

    it('ignores Electron apps, which have a Local State file but no browser profile', async () => {
        const probe = fakeDisk([
            `${HOME}/.config/Code/Local State`,
            `${HOME}/.config/Code/First Run`,
            `${HOME}/.config/Code/Network/Cookies`,
            `${HOME}/.config/Slack/Local State`
        ]);
        await expect(detectBrowsers(LINUX, probe)).resolves.toEqual([]);
    });

    it('ignores an app with an embedded browser: it has a Default profile with cookies but no First Run marker', async () => {
        const probe = fakeDisk(chromiumFiles(`${HOME}/.config/Codex`, { firstRun: false }));
        await expect(detectBrowsers(LINUX, probe)).resolves.toEqual([]);
    });

    it('accepts a browser without the First Run marker when the system has it registered, and uses the registered name', async () => {
        const registered: RegisteredBrowser[] = [{ name: 'Brave Origin', key: 'brave-origin-stable' }];
        const probe = fakeDisk(chromiumFiles(ORIGIN_DIR, { firstRun: false }));
        await expect(detectBrowsers(LINUX, probe, registered)).resolves.toEqual([
            { label: 'Brave Origin', engine: 'brave', dataDir: ORIGIN_DIR, profiles: [{ id: 'Default', name: 'Default' }] }
        ]);
    });

    it('only renames a browser after the registration of the same product', async () => {
        const registered: RegisteredBrowser[] = [{ name: 'Chromium Web Browser', key: 'chromium-browser' }];
        const probe = fakeDisk([...chromiumFiles(`${HOME}/.config/chromium`), ...chromiumFiles(`${HOME}/.config/google-chrome`)]);
        const labels = (await detectBrowsers(LINUX, probe, registered)).map((browser) => {
            return browser.label;
        });
        expect(labels).toEqual(['Chromium Web Browser', 'Google Chrome']);
    });

    it('does not list a registered browser that has no profile with cookies', async () => {
        const registered: RegisteredBrowser[] = [{ name: 'Brave Origin', key: 'brave-origin-stable' }];
        const probe = fakeDisk([`${ORIGIN_DIR}/Local State`, `${ORIGIN_DIR}/Default/Preferences`]);
        await expect(detectBrowsers(LINUX, probe, registered)).resolves.toEqual([]);
    });

    it('ignores folders that have cookies but no Local State file', async () => {
        const probe = fakeDisk([`${HOME}/.config/chromium/First Run`, `${HOME}/.config/chromium/Default/Cookies`]);
        await expect(detectBrowsers(LINUX, probe)).resolves.toEqual([]);
    });

    it('finds a recent Firefox with the profiles listed in profiles.ini, leaving out the ones without cookies', async () => {
        const probe = fakeDisk(
            [
                `${FIREFOX_DIR}/profiles.ini`,
                `${FIREFOX_DIR}/mjan87q3.default-release/cookies.sqlite`,
                `${FIREFOX_DIR}/ce8zm06m.default/prefs.js`
            ],
            {
                contents: {
                    [`${FIREFOX_DIR}/profiles.ini`]: [
                        '[Profile0]',
                        'Name=default-release',
                        'IsRelative=1',
                        'Path=mjan87q3.default-release',
                        '',
                        '[Profile1]',
                        'Name=default',
                        'IsRelative=1',
                        'Path=ce8zm06m.default'
                    ].join('\n')
                }
            }
        );
        await expect(detectBrowsers(LINUX, probe)).resolves.toEqual([
            { label: 'Firefox', engine: 'firefox', dataDir: FIREFOX_DIR, profiles: [{ id: 'mjan87q3.default-release', name: 'default-release' }] }
        ]);
    });

    it('uses the registered name of Firefox', async () => {
        const probe = fakeDisk([`${FIREFOX_DIR}/profiles.ini`, `${FIREFOX_DIR}/abc.default/cookies.sqlite`]);
        const [browser] = await detectBrowsers(LINUX, probe, [{ name: 'Firefox Web Browser', key: 'firefox' }]);
        expect(browser?.label).toBe('Firefox Web Browser');
    });

    it('takes any folder with cookies.sqlite as a profile when profiles.ini has no usable list', async () => {
        const probe = fakeDisk([`${FIREFOX_DIR}/profiles.ini`, `${FIREFOX_DIR}/abc.default/cookies.sqlite`, `${FIREFOX_DIR}/Crash Reports/x.txt`]);
        const [browser] = await detectBrowsers(LINUX, probe);
        expect(browser?.profiles).toEqual([{ id: 'abc.default', name: 'abc.default' }]);
    });

    it('finds Firefox wherever its folder is, as long as it holds a browser profile', async () => {
        const probe = fakeDisk([`${HOME}/.config/some-vendor/waterfox/profiles.ini`, `${HOME}/.config/some-vendor/waterfox/abc.default/cookies.sqlite`]);
        await expect(detectBrowsers(LINUX, probe)).resolves.toEqual([
            {
                label: 'Waterfox',
                engine: 'firefox',
                dataDir: `${HOME}/.config/some-vendor/waterfox`,
                profiles: [{ id: 'abc.default', name: 'abc.default' }]
            }
        ]);
    });

    it('finds Firefox and its forks, but not Mozilla apps without a browser profile', async () => {
        const probe = fakeDisk([
            `${HOME}/.mozilla/firefox/profiles.ini`,
            `${HOME}/.mozilla/firefox/abcd.default-release/cookies.sqlite`,
            `${HOME}/.librewolf/profiles.ini`,
            `${HOME}/.librewolf/xyz.default/cookies.sqlite`,
            `${HOME}/.thunderbird/profiles.ini`,
            `${HOME}/.thunderbird/mail.default/prefs.js`
        ]);
        const found = (await detectBrowsers(LINUX, probe)).map((browser) => {
            return [browser.label, browser.dataDir];
        });
        expect(found).toEqual([
            ['Firefox', `${HOME}/.mozilla/firefox`],
            ['Librewolf', `${HOME}/.librewolf`]
        ]);
    });

    it('lists both Firefox folders when an old and a recent profile exist', async () => {
        const probe = fakeDisk([
            `${FIREFOX_DIR}/profiles.ini`,
            `${FIREFOX_DIR}/new.default/cookies.sqlite`,
            `${HOME}/.mozilla/firefox/profiles.ini`,
            `${HOME}/.mozilla/firefox/old.default/cookies.sqlite`
        ]);
        const dirs = (await detectBrowsers(LINUX, probe)).map((browser) => {
            return browser.dataDir;
        });
        expect(dirs).toEqual([FIREFOX_DIR, `${HOME}/.mozilla/firefox`]);
    });

    it('labels Flatpak and Snap installs', async () => {
        const braveDir = `${HOME}/.var/app/com.brave.Browser/config/BraveSoftware/Brave-Browser`;
        const probe = fakeDisk([
            ...chromiumFiles(braveDir),
            ...chromiumFiles(`${HOME}/snap/chromium/common/chromium`),
            `${HOME}/.var/app/org.mozilla.firefox/.mozilla/firefox/profiles.ini`,
            `${HOME}/.var/app/org.mozilla.firefox/.mozilla/firefox/p1.default/cookies.sqlite`,
            `${HOME}/snap/firefox/common/.mozilla/firefox/profiles.ini`,
            `${HOME}/snap/firefox/common/.mozilla/firefox/p2.default/cookies.sqlite`
        ]);
        const found = (await detectBrowsers(LINUX, probe)).map((browser) => {
            return [browser.label, browser.engine, browser.dataDir];
        });
        expect(found).toEqual([
            ['Brave Browser (Flatpak)', 'brave', braveDir],
            ['Chromium (Snap)', 'chromium', `${HOME}/snap/chromium/common/chromium`],
            ['Firefox (Flatpak)', 'firefox', `${HOME}/.var/app/org.mozilla.firefox/.mozilla/firefox`],
            ['Firefox (Snap)', 'firefox', `${HOME}/snap/firefox/common/.mozilla/firefox`]
        ]);
    });

    it('reports a browser only once', async () => {
        const probe = fakeDisk(chromiumFiles(`${HOME}/.config/chromium`));
        expect(await detectBrowsers(LINUX, probe)).toHaveLength(1);
    });

    it('returns an empty list when nothing is installed', async () => {
        await expect(detectBrowsers(LINUX, fakeDisk([]))).resolves.toEqual([]);
    });
});

describe('detectBrowsers on Windows', () => {
    const LOCAL = 'C:\\Users\\lucas\\AppData\\Local';
    const ROAMING = 'C:\\Users\\lucas\\AppData\\Roaming';
    const WINDOWS: DetectionEnvironment = {
        platform: 'win32',
        homeDir: 'C:\\Users\\lucas',
        env: { LOCALAPPDATA: LOCAL, APPDATA: ROAMING }
    };
    const disk = (files: string[], contents: Record<string, string> = {}): FileProbe => {
        return fakeDisk(files, { separator: '\\', contents });
    };
    const windowsBrowser = (dir: string, layout: ChromiumLayout = { cookiesFile: 'Network/Cookies' }): string[] => {
        return chromiumFiles(dir, { cookiesFile: 'Network/Cookies', ...layout }, '\\');
    };

    it('finds browsers under "User Data" and labels them by their own folder', async () => {
        const probe = disk([
            ...windowsBrowser(`${LOCAL}\\Google\\Chrome\\User Data`),
            ...windowsBrowser(`${LOCAL}\\BraveSoftware\\Brave-Origin\\User Data`),
            ...windowsBrowser(`${LOCAL}\\Microsoft\\Edge\\User Data`)
        ]);
        const found = (await detectBrowsers(WINDOWS, probe)).map((browser) => {
            return [browser.label, browser.engine, browser.dataDir];
        });
        expect(found).toEqual([
            ['Brave Origin', 'brave', `${LOCAL}\\BraveSoftware\\Brave-Origin\\User Data`],
            ['Chrome', 'chrome', `${LOCAL}\\Google\\Chrome\\User Data`],
            ['Edge', 'edge', `${LOCAL}\\Microsoft\\Edge\\User Data`]
        ]);
    });

    it('uses the name registered in the system and accepts a browser without the First Run marker', async () => {
        const probe = disk(windowsBrowser(`${LOCAL}\\Google\\Chrome\\User Data`, { firstRun: false }));
        const [browser] = await detectBrowsers(WINDOWS, probe, [{ name: 'Google Chrome', key: 'Chrome' }]);
        expect(browser).toEqual({
            label: 'Google Chrome',
            engine: 'chrome',
            dataDir: `${LOCAL}\\Google\\Chrome\\User Data`,
            profiles: [{ id: 'Default', name: 'Default' }]
        });
    });

    it('finds Firefox in the roaming folder, with its profiles inside "Profiles"', async () => {
        const dir = `${ROAMING}\\Mozilla\\Firefox`;
        const probe = disk([`${dir}\\profiles.ini`, `${dir}\\Profiles\\a.default\\cookies.sqlite`]);
        await expect(detectBrowsers(WINDOWS, probe)).resolves.toEqual([
            { label: 'Firefox', engine: 'firefox', dataDir: dir, profiles: [{ id: 'Profiles/a.default', name: 'Profiles/a.default' }] }
        ]);
    });

    it('reads the profile names of Firefox from profiles.ini', async () => {
        const dir = `${ROAMING}\\Mozilla\\Firefox`;
        const probe = disk([`${dir}\\profiles.ini`, `${dir}\\Profiles\\a.default\\cookies.sqlite`], {
            [`${dir}\\profiles.ini`]: '[Profile0]\r\nName=work\r\nIsRelative=1\r\nPath=Profiles/a.default\r\n'
        });
        const [browser] = await detectBrowsers(WINDOWS, probe);
        expect(browser?.profiles).toEqual([{ id: 'Profiles/a.default', name: 'work' }]);
    });

    it('finds the Microsoft Store build of Firefox inside its package', async () => {
        const dir = `${LOCAL}\\Packages\\Mozilla.Firefox_n80bbvh6b1yt2\\LocalCache\\Roaming\\Mozilla\\Firefox`;
        const probe = disk([`${dir}\\profiles.ini`, `${dir}\\Profiles\\s.default\\cookies.sqlite`]);
        await expect(detectBrowsers(WINDOWS, probe)).resolves.toEqual([
            { label: 'Firefox (Microsoft Store)', engine: 'firefox', dataDir: dir, profiles: [{ id: 'Profiles/s.default', name: 'Profiles/s.default' }] }
        ]);
    });

    it('finds a Firefox fork in the roaming folder', async () => {
        const dir = `${ROAMING}\\librewolf`;
        const probe = disk([`${dir}\\profiles.ini`, `${dir}\\Profiles\\a.default\\cookies.sqlite`]);
        const [browser] = await detectBrowsers(WINDOWS, probe);
        expect([browser?.label, browser?.dataDir]).toEqual(['Librewolf', dir]);
    });

    it('does not walk into the Temp folder', async () => {
        await expect(detectBrowsers(WINDOWS, disk(windowsBrowser(`${LOCAL}\\Temp\\Chrome\\User Data`)))).resolves.toEqual([]);
    });

    it('falls back to the default AppData folders when the variables are missing', async () => {
        const probe = disk(windowsBrowser(`${LOCAL}\\Google\\Chrome\\User Data`));
        const found = await detectBrowsers({ ...WINDOWS, env: {} }, probe);
        expect(found.map((browser) => {
            return browser.dataDir;
        })).toEqual([`${LOCAL}\\Google\\Chrome\\User Data`]);
    });
});

describe('detectBrowsers on other systems', () => {
    it('finds nothing on platforms it does not support', async () => {
        const probe = fakeDisk(chromiumFiles(`${HOME}/.config/chromium`));
        await expect(detectBrowsers({ platform: 'darwin', homeDir: HOME, env: {} }, probe)).resolves.toEqual([]);
    });
});
