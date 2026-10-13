// Programs the app downloads for itself (a download of a few hundred megabytes, so it shows what it is doing).

export type ToolId = 'suwayomi' | 'flaresolverr' | ProgramId;

// The programs that the video downloader, the anime section and the app need, downloaded on the first run (each one in a folder of its
// own inside the data folder of the app, so the ones of the user's system are never used by mistake).
export const PROGRAM_IDS = ['ytdlp', 'deno', 'ffmpeg', 'anicli', 'busybox', 'curl'] as const;
export type ProgramId = (typeof PROGRAM_IDS)[number];

export type ToolStatus = 'missing' | 'downloading' | 'verifying' | 'extracting' | 'ready' | 'error';

export type ToolErrorCode = 'UNSUPPORTED_PLATFORM' | 'DOWNLOAD_FAILED' | 'HASH_MISMATCH' | 'EXTRACT_FAILED' | 'INCOMPLETE' | 'DISK' | 'DOCKER_MISSING' | 'INVALID';

export interface ToolError {
    code: ToolErrorCode;
    message: string;
}

export interface ToolState {
    id: ToolId;
    status: ToolStatus;
    // The version installed (or being installed).
    version: string | null;
    bytesDone: number;
    bytesTotal: number;
    // 0 to 100: of the download while it goes on, then the whole job.
    percent: number;
    error: ToolError | null;
}

// `raw` is a file that is not packed (a program that is one file): it is put in its place as it is. `tar.xz` is unpacked with the `tar` of the
// system, which has to know xz.
export type ArchiveFormat = 'tar.gz' | 'zip' | 'tar.xz' | 'raw';

// One program for one system: where it comes from, how to check it and how to unpack it.
export interface ToolSpec {
    id: ToolId;
    version: string;
    url: string;
    // The checksum of the archive the publisher gives.
    sha256: string;
    sizeBytes: number;
    format: ArchiveFormat;
    // Leading folders of the archive that are dropped (the archive has one folder that holds everything).
    stripComponents: number;
    // Folders (after the leading ones are dropped) that are not needed and are not unpacked.
    exclude: readonly string[];
    // Files that must be runnable once unpacked.
    executables: readonly string[];
    // A file that must exist for the install to count as complete.
    entry: string;
}
