import type { MessageKey, Translator } from '@shared/i18n';
import type { ProgramLookupReason } from '@shared/programs';
import { ANICLI_UPDATE_STEPS, type AniCliUpdateStep, type ProgramId, type ToolError, type ToolErrorCode, type ToolState, type ToolStatus } from '@shared/tools';
import { codedErrorReport, type ErrorReport } from './errorReport';

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
    incompatible: 'tools.lookup.incompatible',
    failed: 'tools.lookup.failed'
};

const UPDATE_STEP_KEYS: Record<AniCliUpdateStep, MessageKey> = {
    compatibility: 'tools.step.compatibility',
    download: 'tools.step.download',
    syntax: 'tools.step.syntax',
    search: 'tools.step.search',
    episodes: 'tools.step.episodes',
    episode: 'tools.step.episode'
};

export function updateStepKey(step: AniCliUpdateStep): MessageKey {
    return UPDATE_STEP_KEYS[step];
}

export type UpdateStepState = 'done' | 'running' | 'failed' | 'pending';

// How each step of an update of ani-cli stands, from what the update tells: the steps before the one it is at are done, that one is going on
// (or is where it stopped), and the ones after it are still to come. A state without a step is the download.
export function updateStepStates(state: ToolState): Array<{ step: AniCliUpdateStep; state: UpdateStepState }> {
    const current = ANICLI_UPDATE_STEPS.indexOf(state.step ?? 'download');
    return ANICLI_UPDATE_STEPS.map((step, position) => {
        if (position < current) {
            return { step, state: 'done' };
        }
        if (position > current) {
            return { step, state: 'pending' };
        }
        return { step, state: state.status === 'error' ? 'failed' : 'running' };
    });
}

const PROGRESS_KEYS: Record<Exclude<ToolStatus, 'ready' | 'error'>, MessageKey> = {
    missing: 'tools.status.missing',
    downloading: 'tools.status.downloading',
    verifying: 'tools.status.verifying',
    extracting: 'tools.status.extracting'
};

export function programErrorKey(code: ToolErrorCode): MessageKey {
    return ERROR_KEYS[code];
}

// The failure of a program to be installed, in words for the user and with what the app knows about it.
export function programErrorReport(t: Translator, error: ToolError): ErrorReport {
    return codedErrorReport(t(programErrorKey(error.code)), error, error.message);
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
