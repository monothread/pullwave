import { execFile } from 'node:child_process';
import { chmodSync, mkdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import type { UpdateResult } from '@shared/types';
import type { AniCliLocator } from './aniCliLocator';
import { patchReport, REQUIRED_PATCHES, type PatchName } from './aniPatches';
import { compareVersions, parseAniCliVersion } from './aniVersion';
import { translateMain } from './language';

export const COMMIT_API_URL = 'https://api.github.com/repos/pystardust/ani-cli/commits/master';
export const RAW_SCRIPT_URL = 'https://raw.githubusercontent.com/pystardust/ani-cli';
// The script is a few tens of kilobytes; something far bigger is not it.
export const MAX_SCRIPT_BYTES = 500_000;
const USER_AGENT = 'pullwave';
const SYNTAX_CHECK_TIMEOUT_MS = 15000;
// How long a request may take: a stalled connection does not hold the update forever.
export const FETCH_TIMEOUT_MS = 30000;

// What the app calls each change it makes to ani-cli, in the words of the messages.
const PATCH_MESSAGE_KEYS = {
    subtitleSelection: 'anicli.patchSubtitleSelection',
    allSubtitles: 'anicli.patchAllSubtitles',
    debugReferer: 'anicli.patchDebugReferer'
} as const;

export interface AniCliUpdaterDependencies {
    fetchText: (url: string) => Promise<string>;
    // Whether the shell that ships with the app accepts the script (`sh -n`: it reads it without running it).
    checkSyntax: (path: string) => Promise<boolean>;
    readText: (path: string) => string | null;
    writeFile: (path: string, content: string) => void;
    replaceFile: (from: string, to: string) => void;
    removeFile: (path: string) => void;
    makeDirectory: (path: string) => void;
}

export const defaultFetchText = async (url: string): Promise<string> => {
    const response = await fetch(url, { headers: { 'User-Agent': USER_AGENT }, redirect: 'follow', signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    if (!response.ok) {
        throw new Error(`Request failed (${response.status}) for ${url}`);
    }
    return response.text();
};

export function createDefaultUpdaterDependencies(busybox: string, readText: (path: string) => string | null): AniCliUpdaterDependencies {
    return {
        fetchText: defaultFetchText,
        checkSyntax: (path) => {
            return new Promise((resolve) => {
                execFile(busybox, ['sh', '-n', path], { timeout: SYNTAX_CHECK_TIMEOUT_MS }, (error) => {
                    resolve(error === null);
                });
            });
        },
        readText,
        writeFile: (path, content) => {
            writeFileSync(path, content);
            chmodSync(path, 0o755);
        },
        replaceFile: (from, to) => {
            renameSync(from, to);
        },
        removeFile: (path) => {
            rmSync(path, { force: true });
        },
        makeDirectory: (path) => {
            mkdirSync(path, { recursive: true });
        }
    };
}

// What came from the network has to look like ani-cli before it replaces anything.
function looksLikeAniCli(script: string): boolean {
    return script.startsWith('#!/bin/sh') && script.length <= MAX_SCRIPT_BYTES && parseAniCliVersion(script) !== null;
}

// The changes of Pullwave that do not fit the script.
function unfitPatches(script: string): PatchName[] {
    const report = patchReport(script);
    return (Object.keys(report) as PatchName[]).filter((name) => {
        return !report[name];
    });
}

function patchNames(names: readonly PatchName[]): string {
    return names
        .map((name) => {
            return translateMain(PATCH_MESSAGE_KEYS[name]);
        })
        .join(', ');
}

// Goes back to the ani-cli that ships with the app: the one an update saved is deleted (the patched copy is made again from whichever
// script is used next).
export function resetAniCli(locator: AniCliLocator, deps: AniCliUpdaterDependencies): UpdateResult {
    if (deps.readText(locator.userAniCliPath) === null) {
        return { ok: false, output: translateMain('anicli.noUpdatedCopy') };
    }
    deps.removeFile(locator.userAniCliPath);
    return { ok: true, output: translateMain('anicli.resetDone') };
}

// Replaces the ani-cli the app runs with the latest one from its repository, kept in the user data folder (the one that ships
// with the app is left alone, and is used again if it is newer after an update of the app). The commit is asked for first so
// the script comes from a fixed address, and it is only installed if it looks like ani-cli and the shell accepts it.
export async function updateAniCli(locator: AniCliLocator, customPath: string, deps: AniCliUpdaterDependencies): Promise<UpdateResult> {
    if (customPath.length > 0) {
        return { ok: false, output: translateMain('anicli.custom') };
    }
    try {
        const commit = (JSON.parse(await deps.fetchText(COMMIT_API_URL)) as { sha?: unknown }).sha;
        if (typeof commit !== 'string' || !/^[0-9a-f]{40}$/.test(commit)) {
            return { ok: false, output: translateMain('anicli.noRelease') };
        }
        const latest = await deps.fetchText(`${RAW_SCRIPT_URL}/${commit}/ani-cli`);
        if (!looksLikeAniCli(latest)) {
            return { ok: false, output: translateMain('anicli.invalid') };
        }
        const latestVersion = parseAniCliVersion(latest) ?? '';
        const current = locator.script('');
        const currentText = current === null ? null : deps.readText(current.path);
        const currentVersion = currentText === null ? null : parseAniCliVersion(currentText);
        const isSame = currentText === latest;
        const isOlder = currentVersion !== null && compareVersions(latestVersion, currentVersion) < 0;
        if (isSame || isOlder) {
            return { ok: true, output: translateMain('anicli.upToDate', { version: currentVersion ?? latestVersion }) };
        }
        // The changes Pullwave makes to the script have to still fit it: without the one that finds the stream the app could not play or
        // download, so that script is not installed; without the others it only loses subtitles, so it is installed and the user is told.
        const unfit = unfitPatches(latest);
        const required = unfit.filter((name) => {
            return REQUIRED_PATCHES.includes(name);
        });
        if (required.length > 0) {
            return { ok: false, output: translateMain('anicli.patchesFailed', { missing: patchNames(required) }) };
        }
        deps.makeDirectory(locator.userBinDirectory);
        const temporaryPath = `${locator.userAniCliPath}.tmp`;
        deps.writeFile(temporaryPath, latest);
        if (!(await deps.checkSyntax(temporaryPath))) {
            deps.removeFile(temporaryPath);
            return { ok: false, output: translateMain('anicli.invalid') };
        }
        deps.replaceFile(temporaryPath, locator.userAniCliPath);
        const from = currentVersion ?? translateMain('ytdlp.versionUnknown');
        if (unfit.length > 0) {
            return { ok: true, output: translateMain('anicli.patchesPartial', { from, to: latestVersion, missing: patchNames(unfit) }) };
        }
        return { ok: true, output: translateMain('anicli.updated', { from, to: latestVersion }) };
    } catch (error) {
        return { ok: false, output: error instanceof Error ? error.message : translateMain('update.failed') };
    }
}
