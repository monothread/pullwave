import { spawn } from 'node:child_process';
import { win32 } from 'node:path';
import type { BrowserName, SiteBrowser } from '@shared/types';

// Opens the page of a manga on its site in the browser the user chose. Where that browser is not found (or cannot be started) the page is
// opened with the browser of the system, so a click always does something. The address is handed to the program as an argument, never
// through a shell, so nothing in it can be taken for a command.

export interface SiteOpenerDependencies {
    platform: NodeJS.Platform;
    env: Record<string, string | undefined>;
    exists: (path: string) => boolean;
    // Starts the program and says whether it started.
    launch: (command: string, args: string[]) => Promise<boolean>;
    // The browser of the system.
    openDefault: (url: string) => void;
}

const LINUX_COMMANDS: Record<BrowserName, readonly string[]> = {
    chrome: ['google-chrome-stable', 'google-chrome'],
    firefox: ['firefox'],
    brave: ['brave-browser', 'brave'],
    chromium: ['chromium', 'chromium-browser'],
    edge: ['microsoft-edge-stable', 'microsoft-edge'],
    opera: ['opera'],
    vivaldi: ['vivaldi-stable', 'vivaldi']
};

const MAC_APPS: Record<BrowserName, string> = {
    chrome: 'Google Chrome',
    firefox: 'Firefox',
    brave: 'Brave Browser',
    chromium: 'Chromium',
    edge: 'Microsoft Edge',
    opera: 'Opera',
    vivaldi: 'Vivaldi'
};

// Where each browser is installed on Windows, under the folders the system says (program files and the folder of the user).
const WINDOWS_PATHS: Record<BrowserName, ReadonlyArray<readonly [string, ...string[]]>> = {
    chrome: [['ProgramFiles', 'Google', 'Chrome', 'Application', 'chrome.exe'], ['ProgramFiles(x86)', 'Google', 'Chrome', 'Application', 'chrome.exe'], ['LOCALAPPDATA', 'Google', 'Chrome', 'Application', 'chrome.exe']],
    firefox: [['ProgramFiles', 'Mozilla Firefox', 'firefox.exe'], ['ProgramFiles(x86)', 'Mozilla Firefox', 'firefox.exe']],
    brave: [['ProgramFiles', 'BraveSoftware', 'Brave-Browser', 'Application', 'brave.exe'], ['ProgramFiles(x86)', 'BraveSoftware', 'Brave-Browser', 'Application', 'brave.exe'], ['LOCALAPPDATA', 'BraveSoftware', 'Brave-Browser', 'Application', 'brave.exe']],
    chromium: [['LOCALAPPDATA', 'Chromium', 'Application', 'chrome.exe'], ['ProgramFiles', 'Chromium', 'Application', 'chrome.exe']],
    edge: [['ProgramFiles(x86)', 'Microsoft', 'Edge', 'Application', 'msedge.exe'], ['ProgramFiles', 'Microsoft', 'Edge', 'Application', 'msedge.exe']],
    opera: [['LOCALAPPDATA', 'Programs', 'Opera', 'opera.exe'], ['ProgramFiles', 'Opera', 'opera.exe']],
    vivaldi: [['LOCALAPPDATA', 'Vivaldi', 'Application', 'vivaldi.exe'], ['ProgramFiles', 'Vivaldi', 'Application', 'vivaldi.exe']]
};

export interface BrowserLaunch {
    command: string;
    args: string[];
}

// The programs that can open the page in this browser on this system, the first to try first.
export function browserLaunches(browser: BrowserName, url: string, deps: Pick<SiteOpenerDependencies, 'platform' | 'env' | 'exists'>): BrowserLaunch[] {
    if (deps.platform === 'win32') {
        return WINDOWS_PATHS[browser].flatMap(([variable, ...parts]) => {
            const folder = deps.env[variable];
            if (folder === undefined || folder.length === 0) {
                return [];
            }
            const path = win32.join(folder, ...parts);
            return deps.exists(path) ? [{ command: path, args: [url] }] : [];
        });
    }
    if (deps.platform === 'darwin') {
        return [{ command: 'open', args: ['-a', MAC_APPS[browser], url] }];
    }
    return LINUX_COMMANDS[browser].map((command) => {
        return { command, args: [url] };
    });
}

export async function openSiteIn(url: string, browser: SiteBrowser, deps: SiteOpenerDependencies): Promise<void> {
    if (browser !== 'default') {
        for (const launch of browserLaunches(browser, url, deps)) {
            if (await deps.launch(launch.command, launch.args)) {
                return;
            }
        }
    }
    deps.openDefault(url);
}

// Starts a program apart from the app (it goes on when the app closes). True once it started; false when it is not there.
export function launchProgram(command: string, args: string[]): Promise<boolean> {
    return new Promise((resolve) => {
        const child = spawn(command, args, { detached: true, stdio: 'ignore' });
        child.once('error', () => {
            return resolve(false);
        });
        child.once('spawn', () => {
            child.unref();
            return resolve(true);
        });
    });
}
