import type { ProgramId, ToolState } from './tools';

export type ProgramArea = 'downloads' | 'anime';

export const AREA_PROGRAMS: Record<ProgramArea, readonly ProgramId[]> = {
    downloads: ['ytdlp', 'deno', 'ffmpeg'],
    anime: ['anicli', 'busybox', 'curl', 'ytdlp', 'deno', 'ffmpeg']
};

export type ProgramPlace = 'global' | 'downloads' | 'anime';

export const PLACE_PROGRAMS: Record<ProgramPlace, readonly ProgramId[]> = {
    global: ['ffmpeg'],
    downloads: ['ytdlp', 'deno'],
    anime: ['anicli', 'busybox', 'curl']
};

export interface ProgramInfo {
    id: ProgramId;
    state: ToolState;
    custom: boolean;
    directory: string | null;
}

export interface ProgramsStatus {
    supported: boolean;
    programs: ProgramInfo[];
}

export type ProgramLookupReason = 'no-release' | 'signature' | 'checksum' | 'invalid' | 'patches' | 'incompatible' | 'failed';

export interface ProgramVersionInfo {
    id: ProgramId;
    current: string | null;
    latest: string | null;
    updatable: boolean;
    base: string | null;
    chosen: boolean;
    error: ProgramLookupReason | null;
    errorMessage: string | null;
}

export type ProgramVersions = Record<ProgramId, ProgramVersionInfo>;

export type ProgramUpdateResult =
    | { ok: true; version: string }
    | { ok: false; reason: 'current' | 'busy' | 'custom' | 'unsupported' | 'lookup' | 'failed'; message: string; lookup?: ProgramLookupReason };

export type ProgramResetResult = { ok: true } | { ok: false; reason: 'none' | 'custom' | 'unsupported' | 'failed'; message: string };
