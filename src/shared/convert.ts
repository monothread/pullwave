export const CONVERT_AUDIO_FORMATS = ['mp3', 'm4a', 'opus', 'flac', 'wav'] as const;

export type ConvertAudioFormat = (typeof CONVERT_AUDIO_FORMATS)[number];

export const CONVERT_OUTPUT_MODES = ['downloads', 'source', 'custom'] as const;

export type ConvertOutputMode = (typeof CONVERT_OUTPUT_MODES)[number];

export const MAX_CONVERT_ITEMS = 200;

export interface ConvertMedia {
    path: string;
    name: string;
    extension: string;
    durationSeconds: number;
}

export type ConvertProbeFailure = 'unreadable' | 'not-video' | 'no-audio' | 'no-ffmpeg';

export type ConvertProbeResponse = { ok: true; media: ConvertMedia } | { ok: false; reason: ConvertProbeFailure };

export type ConvertChooseFailure = 'cancelled' | ConvertProbeFailure;

export interface ConvertChooseRejected {
    path: string;
    reason: ConvertProbeFailure;
}

export type ConvertChooseResponse =
    | { ok: true; media: ConvertMedia[]; rejected: ConvertChooseRejected[] }
    | { ok: false; reason: ConvertChooseFailure };

export interface ConvertRequest {
    paths: string[];
    format: ConvertAudioFormat;
    outputMode: ConvertOutputMode;
    outputDirectory?: string;
}

export type ConvertItemStatus = 'waiting' | 'converting' | 'done' | 'error' | 'cancelled';

export interface ConvertItemState {
    path: string;
    name: string;
    status: ConvertItemStatus;
    percent: number;
    outputPath: string | null;
    error: string | null;
}

export type ConvertRunStatus = 'running' | 'done' | 'cancelled';

export interface ConvertRun {
    id: number;
    format: ConvertAudioFormat;
    outputMode: ConvertOutputMode;
    outputDirectory: string | null;
    status: ConvertRunStatus;
    items: ConvertItemState[];
}

export type ConvertStartFailure = 'busy' | 'invalid' | 'no-ffmpeg' | 'folder';

export type ConvertStartResponse = { ok: true; run: ConvertRun } | { ok: false; reason: ConvertStartFailure };

export interface ConvertApi {
    choose: () => Promise<ConvertChooseResponse>;
    probe: (path: string) => Promise<ConvertProbeResponse>;
    pathForFile: (file: File) => string;
    start: (request: ConvertRequest) => Promise<ConvertStartResponse>;
    cancel: () => Promise<void>;
    current: () => Promise<ConvertRun | null>;
    onProgress: (listener: (run: ConvertRun) => void) => () => void;
    clear: () => Promise<void>;
}
