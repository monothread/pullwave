import type { ErrorDetails } from './errorDetails';

export type ToolId = 'suwayomi' | 'flaresolverr' | ProgramId;

export const PROGRAM_IDS = ['ytdlp', 'deno', 'ffmpeg', 'anicli', 'busybox', 'curl'] as const;
export type ProgramId = (typeof PROGRAM_IDS)[number];

export type ToolStatus = 'missing' | 'downloading' | 'verifying' | 'extracting' | 'ready' | 'error';

export type ToolErrorCode = 'UNSUPPORTED_PLATFORM' | 'DOWNLOAD_FAILED' | 'HASH_MISMATCH' | 'EXTRACT_FAILED' | 'INCOMPLETE' | 'DISK' | 'DOCKER_MISSING' | 'INVALID';

export interface ToolError {
    code: ToolErrorCode;
    message: string;
    details?: ErrorDetails;
}

export const ANICLI_UPDATE_STEPS = ['compatibility', 'download', 'syntax', 'search', 'episodes', 'episode'] as const;
export type AniCliUpdateStep = (typeof ANICLI_UPDATE_STEPS)[number];

export interface ToolState {
    id: ToolId;
    step?: AniCliUpdateStep;
    status: ToolStatus;
    version: string | null;
    bytesDone: number;
    bytesTotal: number;
    percent: number;
    error: ToolError | null;
}

export type ArchiveFormat = 'tar.gz' | 'zip' | 'tar.xz' | 'raw';

export interface ToolSpec {
    id: ToolId;
    version: string;
    url: string;
    sha256: string;
    sizeBytes: number;
    format: ArchiveFormat;
    stripComponents: number;
    exclude: readonly string[];
    executables: readonly string[];
    entry: string;
}
