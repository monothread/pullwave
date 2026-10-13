import type { ProgramId, ToolState } from './tools';

// The changes the app makes to ani-cli (see aniPatches.ts in the main process).
export type AniPatchName = 'subtitleSelection' | 'allSubtitles' | 'debugReferer';

// The programs the app downloads on its first run (see tools.ts), as the screen sees them.

// What each part of the app needs before it can work: the video downloader needs yt-dlp (which runs the JavaScript of the sites with deno) and
// ffmpeg (to join and convert what it downloads); the anime section needs ani-cli with the shell and the curl it runs on, and the other two
// for its streams and subtitles.
export type ProgramArea = 'downloads' | 'anime';

export const AREA_PROGRAMS: Record<ProgramArea, readonly ProgramId[]> = {
    downloads: ['ytdlp', 'deno', 'ffmpeg'],
    anime: ['anicli', 'busybox', 'curl', 'ytdlp', 'deno', 'ffmpeg']
};

// Where the status of each program is shown, with its version, the latest one, and the buttons: ffmpeg in the settings of the whole app (both
// areas use it), yt-dlp (and deno, which it runs the sites' scripts with) in the settings of the video downloader, ani-cli (and the shell and
// the curl it runs on) in the settings of the anime.
export type ProgramPlace = 'global' | 'downloads' | 'anime';

export const PLACE_PROGRAMS: Record<ProgramPlace, readonly ProgramId[]> = {
    global: ['ffmpeg'],
    downloads: ['ytdlp', 'deno'],
    anime: ['anicli', 'busybox', 'curl']
};

export interface ProgramInfo {
    id: ProgramId;
    state: ToolState;
    // A path the user chose in the settings is used instead: nothing is downloaded, and the program is not looked after by the app.
    custom: boolean;
    // The folder of the version that is installed (null while it is not).
    directory: string | null;
}

export interface ProgramsStatus {
    // False where the programs are not made for the system (nothing is downloaded and the app does not run them).
    supported: boolean;
    programs: ProgramInfo[];
}

// Why a look for the latest version did not give one (see LookupReason of the main process).
export type ProgramLookupReason = 'no-release' | 'signature' | 'checksum' | 'invalid' | 'patches' | 'failed';

export interface ProgramVersionInfo {
    id: ProgramId;
    // The version that is chosen (installed, or the one to install), and the latest the publisher has; null when not known.
    current: string | null;
    latest: string | null;
    // The latest one is not the one that is chosen, and it was not downloaded already.
    updatable: boolean;
    // The version the app was made with (null for the programs that have none), and whether the chosen one is not it.
    base: string | null;
    chosen: boolean;
    // Why the latest version is not known, and the words of the detail.
    error: ProgramLookupReason | null;
    errorMessage: string | null;
    // For ani-cli: the changes of the app that do not fit the latest script (it works, without them).
    unfit: AniPatchName[];
}

export type ProgramVersions = Record<ProgramId, ProgramVersionInfo>;

export type ProgramUpdateResult =
    | { ok: true; version: string }
    | { ok: false; reason: 'current' | 'busy' | 'custom' | 'unsupported' | 'lookup' | 'failed'; message: string; lookup?: ProgramLookupReason };

export type ProgramResetResult = { ok: true } | { ok: false; reason: 'none' | 'custom' | 'unsupported' | 'failed'; message: string };
