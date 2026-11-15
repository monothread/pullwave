import { access, readdir, readFile } from 'node:fs/promises';
import { posix, win32 } from 'node:path';
import type { BrowserName, BrowserProfile, DetectedBrowser } from '@shared/types';
import { findRegisteredBrowser, type RegisteredBrowser } from './browserIdentity';
import { parseChromiumProfileNames, parseFirefoxProfiles } from './browserProfiles';

export interface FileProbe {
    listDirectories: (dir: string) => Promise<string[]>;
    listFiles: (dir: string) => Promise<string[]>;
    exists: (path: string) => Promise<boolean>;
    readText: (path: string) => Promise<string | null>;
}

export interface DetectionEnvironment {
    platform: NodeJS.Platform;
    homeDir: string;
    env: Record<string, string | undefined>;
}

const CHROMIUM_STATE_FILE = 'Local State';
const CHROMIUM_FIRST_RUN_FILE = 'First Run';
const FIREFOX_PROFILES_FILE = 'profiles.ini';
const FIREFOX_PROFILES_FOLDER = 'Profiles';
const FIREFOX_COOKIES_FILE = 'cookies.sqlite';
const SKIPPED_FOLDERS = new Set(['temp', 'packages', 'programs', 'packagecache']);
const WINDOWS_DATA_FOLDER = 'User Data';
const COOKIE_FILES: readonly string[][] = [['Cookies'], ['Network', 'Cookies']];

const ENGINE_HINTS: ReadonlyArray<readonly [string, BrowserName]> = [
    ['brave', 'brave'],
    ['edge', 'edge'],
    ['vivaldi', 'vivaldi'],
    ['opera', 'opera'],
    ['chromium', 'chromium'],
    ['chrome', 'chrome']
];

async function listEntries(dir: string, wantDirectories: boolean): Promise<string[]> {
    try {
        const entries = await readdir(dir, { withFileTypes: true });
        return entries
            .filter((entry) => {
                return wantDirectories ? entry.isDirectory() : entry.isFile();
            })
            .map((entry) => {
                return entry.name;
            });
    } catch {
        return [];
    }
}

export const defaultFileProbe: FileProbe = {
    listDirectories: (dir) => {
        return listEntries(dir, true);
    },
    listFiles: (dir) => {
        return listEntries(dir, false);
    },
    readText: async (path) => {
        try {
            return await readFile(path, 'utf-8');
        } catch {
            return null;
        }
    },
    exists: async (path) => {
        try {
            await access(path);
            return true;
        } catch {
            return false;
        }
    }
};

function chooseEngine(dataDir: string): BrowserName {
    const lowered = dataDir.toLowerCase();
    const hint = ENGINE_HINTS.find(([keyword]) => {
        return lowered.includes(keyword);
    });
    return hint ? hint[1] : 'chromium';
}

function humanize(folder: string): string {
    return folder
        .replace(/^\.+/, '')
        .split(/[-_\s]+/)
        .filter((word) => {
            return word.length > 0;
        })
        .map((word) => {
            return word.charAt(0).toUpperCase() + word.slice(1);
        })
        .join(' ');
}

function packagingSuffix(dataDir: string): string {
    const normalized = dataDir.replace(/\\/g, '/');
    if (normalized.includes('/.var/app/')) {
        return ' (Flatpak)';
    }
    if (normalized.includes('/Packages/Mozilla.Firefox_')) {
        return ' (Microsoft Store)';
    }
    return /\/snap\/[^/]+\/common\//.test(normalized) ? ' (Snap)' : '';
}

function lastSegment(path: string): string {
    return path.replace(/\\/g, '/').split('/').filter((part) => {
        return part.length > 0;
    }).pop() ?? '';
}

function labelFor(dataDir: string): string {
    const parts = dataDir.replace(/\\/g, '/').split('/').filter((part) => {
        return part.length > 0;
    });
    const leaf = parts[parts.length - 1] === WINDOWS_DATA_FOLDER ? parts[parts.length - 2] : parts[parts.length - 1];
    return `${humanize(leaf ?? dataDir)}${packagingSuffix(dataDir)}`;
}

interface DetectionContext {
    probe: FileProbe;
    join: (...parts: string[]) => string;
}

interface ScanRoot {
    dir: string;
    depth: number;
}

function childPaths(context: DetectionContext, dir: string, names: string[]): string[] {
    return names.map((name) => {
        return context.join(dir, name);
    });
}

async function anyExists(context: DetectionContext, paths: string[]): Promise<boolean> {
    const results = await Promise.all(
        paths.map((path) => {
            return context.probe.exists(path);
        })
    );
    return results.includes(true);
}

async function listSubfolders(context: DetectionContext, dir: string): Promise<string[]> {
    return childPaths(context, dir, await context.probe.listDirectories(dir));
}

async function collectFolders(context: DetectionContext, root: ScanRoot): Promise<string[]> {
    if (root.depth < 1) {
        return [];
    }
    const children = (await listSubfolders(context, root.dir)).filter((child) => {
        return !SKIPPED_FOLDERS.has(lastSegment(child).toLowerCase());
    });
    const deeper = await Promise.all(
        children.map((child) => {
            return collectFolders(context, { dir: child, depth: root.depth - 1 });
        })
    );
    return [...children, ...deeper.flat()];
}

async function collectAll(context: DetectionContext, roots: ScanRoot[]): Promise<string[]> {
    const found = await Promise.all(
        roots.map((root) => {
            return collectFolders(context, root);
        })
    );
    return [...new Set(found.flat())];
}

async function filterAsync(items: string[], keep: (item: string) => Promise<boolean>): Promise<string[]> {
    const flags = await Promise.all(items.map(keep));
    return items.filter((_item, index) => {
        return flags[index];
    });
}

function profileSortKey(profile: BrowserProfile): string {
    return profile.id === 'Default' ? '' : profile.id;
}

function sortProfiles(profiles: BrowserProfile[]): BrowserProfile[] {
    return [...profiles].sort((left, right) => {
        return profileSortKey(left).localeCompare(profileSortKey(right), undefined, { numeric: true });
    });
}

async function findChromiumProfiles(context: DetectionContext, dir: string): Promise<BrowserProfile[]> {
    const folders = await context.probe.listDirectories(dir);
    const candidates = folders.filter((name) => {
        return name === 'Default' || name.startsWith('Profile ');
    });
    const withCookies = await filterAsync(candidates, (name) => {
        return anyExists(
            context,
            COOKIE_FILES.map((file) => {
                return context.join(dir, name, ...file);
            })
        );
    });
    if (withCookies.length === 0) {
        return [];
    }
    const names = parseChromiumProfileNames(await context.probe.readText(context.join(dir, CHROMIUM_STATE_FILE)));
    return sortProfiles(
        withCookies.map((id) => {
            return { id, name: names[id] ?? id };
        })
    );
}

async function describeChromiumBrowser(context: DetectionContext, dir: string, registered: readonly RegisteredBrowser[]): Promise<DetectedBrowser | null> {
    if (!(await context.probe.exists(context.join(dir, CHROMIUM_STATE_FILE)))) {
        return null;
    }
    const profiles = await findChromiumProfiles(context, dir);
    const known = findRegisteredBrowser(dir, registered);
    if (profiles.length === 0 || (known === null && !(await context.probe.exists(context.join(dir, CHROMIUM_FIRST_RUN_FILE))))) {
        return null;
    }
    return { label: known?.name ?? labelFor(dir), engine: chooseEngine(dir), dataDir: dir, profiles };
}

async function profilesWithCookies(context: DetectionContext, dir: string, ids: string[]): Promise<BrowserProfile[]> {
    const present = await filterAsync(ids, (id) => {
        return context.probe.exists(context.join(dir, id, FIREFOX_COOKIES_FILE));
    });
    return present.map((id) => {
        return { id, name: id };
    });
}

async function findFirefoxProfiles(context: DetectionContext, dir: string): Promise<BrowserProfile[]> {
    const entries = parseFirefoxProfiles(await context.probe.readText(context.join(dir, FIREFOX_PROFILES_FILE)));
    const named = await profilesWithCookies(
        context,
        dir,
        entries.map((entry) => {
            return entry.path;
        })
    );
    if (named.length > 0) {
        return sortProfiles(
            named.map((profile) => {
                return { id: profile.id, name: entries.find((entry) => {
                    return entry.path === profile.id;
                })?.name ?? profile.id };
            })
        );
    }
    const [inside, insideProfilesFolder] = await Promise.all([
        context.probe.listDirectories(dir),
        context.probe.listDirectories(context.join(dir, FIREFOX_PROFILES_FOLDER))
    ]);
    return sortProfiles(
        await profilesWithCookies(context, dir, [
            ...inside,
            ...insideProfilesFolder.map((name) => {
                return `${FIREFOX_PROFILES_FOLDER}/${name}`;
            })
        ])
    );
}

async function describeFirefoxBrowser(context: DetectionContext, dir: string, registered: readonly RegisteredBrowser[]): Promise<DetectedBrowser | null> {
    if (!(await context.probe.exists(context.join(dir, FIREFOX_PROFILES_FILE)))) {
        return null;
    }
    const profiles = await findFirefoxProfiles(context, dir);
    if (profiles.length === 0) {
        return null;
    }
    return { label: findRegisteredBrowser(dir, registered)?.name ?? labelFor(dir), engine: 'firefox', dataDir: dir, profiles };
}

async function describeAll(
    candidates: string[],
    describe: (dir: string) => Promise<DetectedBrowser | null>
): Promise<DetectedBrowser[]> {
    const described = await Promise.all(candidates.map(describe));
    return described.filter((browser): browser is DetectedBrowser => {
        return browser !== null;
    });
}

async function linuxRoots(context: DetectionContext, homeDir: string): Promise<{ chromium: ScanRoot[]; firefox: ScanRoot[] }> {
    const [flatpakApps, snapApps] = await Promise.all([
        listSubfolders(context, context.join(homeDir, '.var', 'app')),
        listSubfolders(context, context.join(homeDir, 'snap'))
    ]);
    const flatpakConfigs = flatpakApps.map((dir) => {
        return { dir: context.join(dir, 'config'), depth: 2 };
    });
    const flatpakMozilla = flatpakApps.map((dir) => {
        return { dir: context.join(dir, '.mozilla'), depth: 1 };
    });
    const snapCommons = snapApps.flatMap((dir) => {
        const common = context.join(dir, 'common');
        return [
            { dir: common, depth: 2 },
            { dir: context.join(common, '.config'), depth: 2 },
            { dir: context.join(common, '.mozilla'), depth: 1 }
        ];
    });
    return {
        chromium: [{ dir: context.join(homeDir, '.config'), depth: 2 }, ...flatpakConfigs, ...snapCommons],
        firefox: [
            { dir: homeDir, depth: 1 },
            { dir: context.join(homeDir, '.config'), depth: 2 },
            { dir: context.join(homeDir, '.mozilla'), depth: 1 },
            ...flatpakConfigs,
            ...flatpakMozilla,
            ...snapCommons
        ]
    };
}

async function windowsRoots(context: DetectionContext, environment: DetectionEnvironment): Promise<{ chromium: ScanRoot[]; firefox: ScanRoot[] }> {
    const { env, homeDir } = environment;
    const localAppData = env.LOCALAPPDATA ?? context.join(homeDir, 'AppData', 'Local');
    const appData = env.APPDATA ?? context.join(homeDir, 'AppData', 'Roaming');
    const storeFirefox = (await listSubfolders(context, context.join(localAppData, 'Packages')))
        .filter((packageDir) => {
            return lastSegment(packageDir).startsWith('Mozilla.Firefox_');
        })
        .map((packageDir) => {
            return { dir: context.join(packageDir, 'LocalCache', 'Roaming'), depth: 2 };
        });
    return {
        chromium: [
            { dir: localAppData, depth: 3 },
            { dir: appData, depth: 3 }
        ],
        firefox: [{ dir: appData, depth: 2 }, ...storeFirefox]
    };
}

export async function detectBrowsers(
    environment: DetectionEnvironment,
    probe: FileProbe = defaultFileProbe,
    registered: readonly RegisteredBrowser[] = []
): Promise<DetectedBrowser[]> {
    if (environment.platform !== 'linux' && environment.platform !== 'win32') {
        return [];
    }
    const context: DetectionContext = { probe, join: environment.platform === 'win32' ? win32.join : posix.join };
    const roots = environment.platform === 'win32' ? await windowsRoots(context, environment) : await linuxRoots(context, environment.homeDir);
    const [chromiumCandidates, firefoxCandidates] = await Promise.all([collectAll(context, roots.chromium), collectAll(context, roots.firefox)]);
    const [chromium, firefox] = await Promise.all([
        describeAll(chromiumCandidates, (dir) => {
            return describeChromiumBrowser(context, dir, registered);
        }),
        describeAll(firefoxCandidates, (dir) => {
            return describeFirefoxBrowser(context, dir, registered);
        })
    ]);
    return [...chromium, ...firefox].sort((left, right) => {
        return left.label.localeCompare(right.label) || left.dataDir.localeCompare(right.dataDir);
    });
}
