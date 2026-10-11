// Programs the app downloads for itself (a download of a few hundred megabytes, so it shows what it is doing).

export type ToolId = 'suwayomi' | 'flaresolverr';

export type ToolStatus = 'missing' | 'downloading' | 'verifying' | 'extracting' | 'ready' | 'error';

export type ToolErrorCode = 'UNSUPPORTED_PLATFORM' | 'DOWNLOAD_FAILED' | 'HASH_MISMATCH' | 'EXTRACT_FAILED' | 'INCOMPLETE' | 'DISK' | 'DOCKER_MISSING';

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

export type ArchiveFormat = 'tar.gz' | 'zip';

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
