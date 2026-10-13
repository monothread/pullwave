import type { MessageKey } from '@shared/i18n';
import type { ProgramLookupReason } from '@shared/programs';
import type { ProgramId, ToolErrorCode, ToolState, ToolStatus } from '@shared/tools';

const ERROR_KEYS: Record<ToolErrorCode, MessageKey> = {
    UNSUPPORTED_PLATFORM: 'tools.error.UNSUPPORTED_PLATFORM',
    DOWNLOAD_FAILED: 'tools.error.DOWNLOAD_FAILED',
    HASH_MISMATCH: 'tools.error.HASH_MISMATCH',
    EXTRACT_FAILED: 'tools.error.EXTRACT_FAILED',
    INCOMPLETE: 'tools.error.INCOMPLETE',
    DISK: 'tools.error.DISK',
    DOCKER_MISSING: 'tools.error.DOCKER_MISSING',
    INVALID: 'tools.error.INVALID'
};

const LOOKUP_KEYS: Record<ProgramLookupReason, MessageKey> = {
    'no-release': 'tools.lookup.no-release',
    signature: 'tools.lookup.signature',
    checksum: 'tools.lookup.checksum',
    invalid: 'tools.lookup.invalid',
    patches: 'tools.lookup.patches',
    failed: 'tools.lookup.failed'
};

const PROGRESS_KEYS: Record<Exclude<ToolStatus, 'ready' | 'error'>, MessageKey> = {
    missing: 'tools.status.missing',
    downloading: 'tools.status.downloading',
    verifying: 'tools.status.verifying',
    extracting: 'tools.status.extracting'
};

export function programErrorKey(code: ToolErrorCode): MessageKey {
    return ERROR_KEYS[code];
}

export function lookupReasonKey(reason: ProgramLookupReason): MessageKey {
    return LOOKUP_KEYS[reason];
}

export function programProgressKey(status: Exclude<ToolStatus, 'ready' | 'error'>): MessageKey {
    return PROGRESS_KEYS[status];
}

// Whether the program is being downloaded or unpacked right now.
export function isWorking(state: ToolState): boolean {
    return state.status === 'downloading' || state.status === 'verifying' || state.status === 'extracting';
}

// A version as it is shown: the commit of ani-cli by its first digits, and the build of ffmpeg (its version is the start of the checksum of the
// file) as a build; the others as they are.
export function displayVersion(id: ProgramId, version: string): string {
    if (id === 'anicli') {
        return version.length === 40 ? version.slice(0, 7) : version;
    }
    if (id === 'ffmpeg') {
        return version.replace(/^latest-/, 'build ');
    }
    return version;
}
