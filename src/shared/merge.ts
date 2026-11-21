export const MERGE_VIDEO_FORMATS = ['mp4', 'mkv', 'webm'] as const;

export type MergeVideoFormat = (typeof MERGE_VIDEO_FORMATS)[number];

export const MERGE_OUTPUT_MODES = ['downloads', 'source', 'custom'] as const;

export type MergeOutputMode = (typeof MERGE_OUTPUT_MODES)[number];

export const MIN_MERGE_ITEMS = 2;
export const MAX_MERGE_ITEMS = 200;

export interface MergeMedia {
    path: string;
    name: string;
    extension: string;
    durationSeconds: number;
    width: number;
    height: number;
    fps: number;
    videoCodec: string;
    pixelFormat: string;
    videoTimebase: string;
    hasAudio: boolean;
    audioCodec: string | null;
    audioSampleRate: number | null;
    audioChannels: string | null;
    streamOrder: string;
}

export type MergeProbeFailure = 'unreadable' | 'not-video' | 'no-ffmpeg';

export type MergeProbeResponse = { ok: true; media: MergeMedia } | { ok: false; reason: MergeProbeFailure };

export type MergeChooseFailure = 'cancelled' | MergeProbeFailure;

export interface MergeChooseRejected {
    path: string;
    reason: MergeProbeFailure;
}

export type MergeChooseResponse =
    | { ok: true; media: MergeMedia[]; rejected: MergeChooseRejected[] }
    | { ok: false; reason: MergeChooseFailure };

export interface MergeRequest {
    paths: string[];
    format: MergeVideoFormat;
    outputMode: MergeOutputMode;
    outputDirectory?: string;
    outputName?: string;
}

export type MergeMethod = 'copy' | 'reencode';

export type MergeRunStatus = 'running' | 'done' | 'error' | 'cancelled';

export interface MergeRun {
    id: number;
    format: MergeVideoFormat;
    outputMode: MergeOutputMode;
    outputDirectory: string;
    outputName: string;
    inputCount: number;
    totalDurationSeconds: number;
    method: MergeMethod;
    status: MergeRunStatus;
    percent: number;
    outputPath: string | null;
    error: string | null;
}

export type MergeStartFailure = 'busy' | 'invalid' | 'no-ffmpeg' | 'folder' | 'unreadable' | 'not-video';

export type MergeStartResponse = { ok: true; run: MergeRun } | { ok: false; reason: MergeStartFailure };

export interface MergeApi {
    choose: () => Promise<MergeChooseResponse>;
    probe: (path: string) => Promise<MergeProbeResponse>;
    pathForFile: (file: File) => string;
    start: (request: MergeRequest) => Promise<MergeStartResponse>;
    cancel: () => Promise<void>;
    current: () => Promise<MergeRun | null>;
    onProgress: (listener: (run: MergeRun) => void) => () => void;
    clear: () => Promise<void>;
}
